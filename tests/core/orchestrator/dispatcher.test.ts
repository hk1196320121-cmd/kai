import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { Dispatcher } from "../../../src/core/orchestrator/dispatcher";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import type { AgentBridge, DispatchResult } from "../../../src/bridge/agent-bridge";

function createMockBridge(): AgentBridge {
  return {
    dispatchOneOff: async (taskId: string, agent: string, _prompt: string): Promise<DispatchResult> => {
      return { success: true, agent, jobId: taskId };
    },
    scheduleCron: async (taskId: string, _schedule: string, _prompt: string): Promise<DispatchResult> => {
      return { success: true, agent: "hermes", jobId: taskId };
    },
    cancelCron: async () => true,
    listPending: async () => [],
  };
}

describe("Dispatcher", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-dispatch-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("dispatch dispatches one-off task to bridge", async () => {
    const bridge = createMockBridge();
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "Do it", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.status).toBe("executing");
  });

  test("dispatch returns error for unknown task", async () => {
    const bridge = createMockBridge();
    const dispatcher = new Dispatcher(store, bridge);
    const result = await dispatcher.dispatch("nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("dispatch handles bridge failure with retry", async () => {
    let calls = 0;
    const bridge: AgentBridge = {
      dispatchOneOff: async () => {
        calls++;
        if (calls < 2) return { success: false, agent: "hermes" };
        return { success: true, agent: "hermes", jobId: "j1" };
      },
      scheduleCron: async () => ({ success: true, agent: "hermes" }),
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(true);
    expect(calls).toBe(2);
  });

  test("dispatch returns error for completed task", async () => {
    const bridge = createMockBridge();
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTaskStatus(task.id, "completed");

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("already completed");
  });

  test("dispatch returns error when max retries exceeded", async () => {
    const bridge = createMockBridge();
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    for (let i = 0; i < task.max_retries; i++) store.incrementRetryCount(task.id);

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Max retries");
  });

  test("dispatch rejects cron task", async () => {
    const bridge = createMockBridge();
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Daily", description: "D", type: "cron", cron_schedule: "0 9 * * *", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Cron tasks must be scheduled");
  });

  test("dispatch returns error when bridge always fails", async () => {
    const bridge: AgentBridge = {
      dispatchOneOff: async () => ({ success: false, agent: "hermes" }),
      scheduleCron: async () => ({ success: true, agent: "hermes" }),
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Bridge dispatch failed");
  });

  test("skips retry when retryable=false (subprocess agent)", async () => {
    let calls = 0;
    const bridge: AgentBridge = {
      dispatchOneOff: async (taskId: string, agent: string, _prompt: string): Promise<DispatchResult> => {
        calls++;
        return { success: false, agent, error: "EXECUTION_FAILED: something went wrong", retryable: false };
      },
      scheduleCron: async () => ({ success: true, agent: "claude" }),
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "claude", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("non-retryable");
    // Bridge was called only ONCE — no retry
    expect(calls).toBe(1);
  });

  test("retries when retryable is undefined (async bridge)", async () => {
    let calls = 0;
    const bridge: AgentBridge = {
      dispatchOneOff: async (taskId: string, agent: string, _prompt: string): Promise<DispatchResult> => {
        calls++;
        return { success: false, agent, error: "temp failure" };
      },
      scheduleCron: async () => ({ success: true, agent: "hermes" }),
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(false);
    // Bridge was called TWICE — initial + retry
    expect(calls).toBe(2);
  });

  test("marks completed for sync bridge with output", async () => {
    const bridge: AgentBridge = {
      dispatchOneOff: async (taskId: string, agent: string, _prompt: string): Promise<DispatchResult> => {
        return { success: true, agent, jobId: taskId, output: "result text" };
      },
      scheduleCron: async () => ({ success: true, agent: "claude" }),
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "claude", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(true);
    expect(result.output).toBe("result text");
    const updated = store.getTask(task.id);
    // Sync bridge with output should mark as completed
    expect(updated?.status).toBe("completed");
  });

  test("retries when retryable is explicitly true", async () => {
    let calls = 0;
    const bridge: AgentBridge = {
      dispatchOneOff: async (taskId: string, agent: string, _prompt: string): Promise<DispatchResult> => {
        calls++;
        return { success: false, agent, error: "retry me", retryable: true };
      },
      scheduleCron: async () => ({ success: true, agent: "hermes" }),
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(false);
    // Bridge was called TWICE — initial + retry
    expect(calls).toBe(2);
  });

  test("non-retryable failure does not increment retry count", async () => {
    const bridge: AgentBridge = {
      dispatchOneOff: async (taskId: string, agent: string, _prompt: string): Promise<DispatchResult> => {
        return { success: false, agent, error: "fail", retryable: false };
      },
      scheduleCron: async () => ({ success: true, agent: "hermes" }),
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(false);
    // retry_count must remain 0 because the failure was non-retryable
    expect(store.getTask(task.id)!.retry_count).toBe(0);
  });

  test("marks executing for async bridge without output", async () => {
    const bridge: AgentBridge = {
      dispatchOneOff: async (taskId: string, agent: string, _prompt: string): Promise<DispatchResult> => {
        return { success: true, agent, jobId: taskId };
      },
      scheduleCron: async () => ({ success: true, agent: "hermes" }),
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    // Async bridge without output should mark as executing
    expect(updated?.status).toBe("executing");
  });
});
