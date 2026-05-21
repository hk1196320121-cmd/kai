import type { AgentBridge } from "../../bridge/agent-bridge";
import type { TelemetryRecorder } from "../telemetry/recorder";
import type { OrchestratorStore } from "./store";

interface DispatchResult {
  success: boolean;
  error?: string;
  jobId?: string;
}

export class Dispatcher {
  private store: OrchestratorStore;
  private bridge: AgentBridge;
  private telemetry: TelemetryRecorder | null;

  constructor(
    store: OrchestratorStore,
    bridge: AgentBridge,
    telemetry: TelemetryRecorder | null = null,
  ) {
    this.store = store;
    this.bridge = bridge;
    this.telemetry = telemetry;
  }

  async dispatch(taskId: string): Promise<DispatchResult> {
    const trace = this.telemetry?.startTrace("internal", "dispatcher.dispatch");
    const span = trace?.startSpan("task_exec", "dispatch task to agent");

    const task = this.store.getTask(taskId);
    if (!task) {
      span?.end("error");
      trace?.end("error");
      return { success: false, error: "Task not found" };
    }
    if (task.status === "completed") {
      span?.end("error");
      trace?.end("error");
      return { success: false, error: "Task already completed" };
    }
    if (task.retry_count >= task.max_retries) {
      span?.end("error");
      trace?.end("error");
      return { success: false, error: "Max retries exceeded" };
    }
    if (task.type === "cron") {
      span?.end("error");
      trace?.end("error");
      return {
        success: false,
        error: "Cron tasks must be scheduled, not dispatched directly",
      };
    }

    try {
      const result = await this.bridge.dispatchOneOff(
        taskId,
        task.agent,
        task.prompt,
      );
      if (!result.success) {
        this.store.incrementRetryCount(taskId);
        const refreshedTask = this.store.getTask(taskId);
        if (
          refreshedTask &&
          refreshedTask.retry_count < refreshedTask.max_retries
        ) {
          const retry = await this.bridge.dispatchOneOff(
            taskId,
            refreshedTask.agent,
            refreshedTask.prompt,
          );
          if (retry.success) {
            this.store.updateTaskStatus(taskId, "executing");
            span?.end("ok");
            trace?.end("completed");
            return { success: true, jobId: retry.jobId };
          }
        }
        span?.end("error");
        trace?.end("error");
        return { success: false, error: "Bridge dispatch failed after retry" };
      }

      this.store.updateTaskStatus(taskId, "executing");
      span?.end("ok");
      trace?.end("completed");
      return { success: true, jobId: result.jobId };
    } catch (err) {
      span?.error(err as Error);
      span?.end("error");
      trace?.end("error");
      throw err;
    }
  }
}
