import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { Scheduler } from "../../../src/core/orchestrator/scheduler";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import type { AgentBridge, DispatchResult } from "../../../src/bridge/agent-bridge";
import type { Trait } from "../../../src/core/profile/types";

function createMockBridge(): AgentBridge {
  return {
    dispatchOneOff: async (taskId, agent): Promise<DispatchResult> => ({ success: true, agent, jobId: taskId }),
    scheduleCron: async (taskId, _schedule, _prompt): Promise<DispatchResult> => ({ success: true, agent: "hermes", jobId: taskId }),
    cancelCron: async () => true,
    listPending: async () => [],
  };
}

describe("Scheduler", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-sched-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("scheduleTasks marks tasks as scheduled", async () => {
    const bridge = createMockBridge();
    const scheduler = new Scheduler(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const t1 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const t2 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T2", description: "D", type: "cron", agent: "hermes", prompt: "P", cron_schedule: "0 9 * * *", cron_prompt: "Daily", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await scheduler.scheduleTasks(idea.id, []);
    expect(result.scheduled).toBe(2);
    expect(store.getTask(t1.id)?.status).toBe("scheduled");
    expect(store.getTask(t2.id)?.status).toBe("scheduled");
  });

  test("scheduleTasks adjusts cron schedule based on early_riser trait", async () => {
    const scheduledJobs: { id: string; schedule: string }[] = [];
    const bridge: AgentBridge = {
      dispatchOneOff: async (taskId, agent): Promise<DispatchResult> => ({ success: true, agent, jobId: taskId }),
      scheduleCron: async (taskId, schedule, _prompt): Promise<DispatchResult> => {
        scheduledJobs.push({ id: taskId, schedule });
        return { success: true, agent: "hermes", jobId: taskId };
      },
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const scheduler = new Scheduler(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Morning cron", description: "D", type: "cron", agent: "hermes", prompt: "P", cron_schedule: "0 12 * * *", cron_prompt: "Daily", decomposition_rationale: "R", scheduling_rationale: "R" });

    const traits: Trait[] = [
      { id: "1", dimension: "early_riser", value: 0.9, confidence: 8, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];
    await scheduler.scheduleTasks(idea.id, traits);
    expect(scheduledJobs.length).toBe(1);
    const hour = parseInt(scheduledJobs[0].schedule.split(/\s+/)[1], 10);
    expect(hour).toBeGreaterThanOrEqual(6);
    expect(hour).toBeLessThanOrEqual(9);
  });

  test("pauseTasks cancels cron jobs and marks tasks paused", async () => {
    const bridge = createMockBridge();
    const scheduler = new Scheduler(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "cron", agent: "hermes", prompt: "P", cron_schedule: "0 9 * * *", cron_prompt: "C", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTaskStatus(task.id, "scheduled");
    store.updateIdeaStatus(idea.id, "executing");

    const result = await scheduler.pauseTasks(idea.id);
    expect(result.paused).toBe(1);
    expect(store.getTask(task.id)?.status).toBe("paused");
    expect(store.getIdea(idea.id)?.status).toBe("paused");
  });
});
