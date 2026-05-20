import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { Observer } from "../../../src/core/orchestrator/observer";
import { ProfileEngine } from "../../../src/core/profile/engine";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("Observer", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let profileEngine: ProfileEngine;
  let observer: Observer;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-observer-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
    profileEngine = new ProfileEngine(db);
    observer = new Observer(store, profileEngine);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  function setupIdeaWithTask() {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "coding", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "Do coding", type: "one_off", agent: "hermes", prompt: "Code", decomposition_rationale: "R", scheduling_rationale: "R" });
    return { idea, task };
  }

  test("processResult emits observations for successful execution", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "Done", duration_ms: 1500 });

    const observations = observer.processResult(result);
    expect(observations.length).toBeGreaterThanOrEqual(2);
    expect(observations.some((o) => o.key.includes("task_completion"))).toBe(true);
    expect(observations.some((o) => o.key.includes("duration"))).toBe(true);
  });

  test("processResult emits failure observation for failed task", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: false, output: "Error: timeout", duration_ms: 30000 });

    const observations = observer.processResult(result);
    const completion = observations.find((o) => o.key.includes("task_completion"));
    expect(completion).toBeDefined();
    const value = JSON.parse(completion!.value);
    expect(value.success).toBe(false);
  });

  test("processResult marks task completed on success", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "Done", duration_ms: 100 });
    observer.processResult(result);
    expect(store.getTask(task.id)?.status).toBe("completed");
  });

  test("processResult marks task failed on failure", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: false, output: "Error", duration_ms: 100 });
    observer.processResult(result);
    expect(store.getTask(task.id)?.status).toBe("failed");
  });

  test("processFeedback emits feedback observation", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "Done", duration_ms: 100 });
    const observations = observer.processFeedback(result.id, "Great job, very thorough!");
    expect(observations.length).toBeGreaterThanOrEqual(1);
    const feedback = observations.find((o) => o.key.includes("feedback"));
    expect(feedback).toBeDefined();
  });

  test("processAllResults handles multiple results", () => {
    const { idea } = setupIdeaWithTask();
    const t1 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const t2 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T2", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.addExecutionResult({ task_id: t1.id, agent: "hermes", success: true, output: "OK", duration_ms: 100 });
    store.addExecutionResult({ task_id: t2.id, agent: "hermes", success: false, output: "Fail", duration_ms: 200 });
    const allObs = observer.processAllResults(idea.id);
    expect(allObs.length).toBeGreaterThanOrEqual(4);
  });

  test("getProfileUpdates returns trait changes since a date", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "Done", duration_ms: 100 });
    observer.processResult(result);
    const updates = observer.getProfileUpdates("2026-01-01");
    expect(Array.isArray(updates)).toBe(true);
  });
});
