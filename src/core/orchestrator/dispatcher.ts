import type { AgentBridge, DispatchResult } from "../../bridge/agent-bridge";
import type { TelemetryRecorder } from "../telemetry/recorder";
import type { OrchestratorStore } from "./store";

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
      return { success: false, agent: "", error: "Task not found" };
    }
    if (task.status === "completed") {
      span?.end("error");
      trace?.end("error");
      return {
        success: false,
        agent: task.agent,
        error: "Task already completed",
      };
    }
    if (task.retry_count >= task.max_retries) {
      span?.end("error");
      trace?.end("error");
      return {
        success: false,
        agent: task.agent,
        error: "Max retries exceeded",
      };
    }
    if (task.type === "cron") {
      span?.end("error");
      trace?.end("error");
      return {
        success: false,
        agent: task.agent,
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
        // Subprocess agents (retryable=false) should not be retried —
        // partial file edits could leave the workspace in a broken state.
        if (result.retryable === false) {
          span?.end("error");
          trace?.end("error");
          return {
            ...result,
            error: `${result.error ?? "Bridge dispatch failed"} (non-retryable)`,
          };
        }
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
            // Sync bridges (output !== undefined) are already done — mark completed
            const status =
              retry.output !== undefined ? "completed" : "executing";
            this.store.updateTaskStatus(taskId, status);
            span?.end("ok");
            trace?.end("completed");
            return {
              success: true,
              agent: task.agent,
              jobId: retry.jobId,
              output: retry.output,
            };
          }
        }
        span?.end("error");
        trace?.end("error");
        return {
          success: false,
          agent: task.agent,
          error: "Bridge dispatch failed after retry",
        };
      }

      // Sync bridges (output !== undefined) completed immediately — mark completed.
      // Async bridges (output === undefined) are still running — mark executing.
      const status = result.output !== undefined ? "completed" : "executing";
      this.store.updateTaskStatus(taskId, status);
      span?.end("ok");
      trace?.end("completed");
      return {
        success: true,
        agent: task.agent,
        jobId: result.jobId,
        output: result.output,
      };
    } catch (err) {
      span?.error(err as Error);
      span?.end("error");
      trace?.end("error");
      throw err;
    }
  }
}
