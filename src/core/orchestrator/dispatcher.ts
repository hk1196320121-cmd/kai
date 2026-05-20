import type { AgentBridge } from "../../bridge/agent-bridge";
import type { OrchestratorStore } from "./store";

interface DispatchResult {
  success: boolean;
  error?: string;
  jobId?: string;
}

export class Dispatcher {
  private store: OrchestratorStore;
  private bridge: AgentBridge;

  constructor(store: OrchestratorStore, bridge: AgentBridge) {
    this.store = store;
    this.bridge = bridge;
  }

  async dispatch(taskId: string): Promise<DispatchResult> {
    const task = this.store.getTask(taskId);
    if (!task) return { success: false, error: "Task not found" };
    if (task.status === "completed")
      return { success: false, error: "Task already completed" };
    if (task.retry_count >= task.max_retries)
      return { success: false, error: "Max retries exceeded" };
    if (task.type === "cron")
      return {
        success: false,
        error: "Cron tasks must be scheduled, not dispatched directly",
      };

    const result = await this.bridge.dispatchOneOff(
      taskId,
      task.agent,
      task.prompt,
    );
    if (!result.success) {
      this.store.incrementRetryCount(taskId);
      const task2 = this.store.getTask(taskId);
      if (task2 && task2.retry_count < task2.max_retries) {
        const retry = await this.bridge.dispatchOneOff(
          taskId,
          task2.agent,
          task2.prompt,
        );
        if (retry.success) {
          this.store.updateTaskStatus(taskId, "executing");
          return { success: true, jobId: retry.jobId };
        }
      }
      return { success: false, error: "Bridge dispatch failed after retry" };
    }

    this.store.updateTaskStatus(taskId, "executing");
    return { success: true, jobId: result.jobId };
  }
}
