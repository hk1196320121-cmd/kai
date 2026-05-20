import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("OrchestratorStore", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-orch-store-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  // --- Ideas ---
  test("createIdea inserts and returns idea", () => {
    const idea = store.createIdea({
      title: "Learn Rust",
      description: "Build a CLI tool",
      domain: "coding",
      priority: "high",
      workspace_id: "ws-1",
    });
    expect(idea.id).toBeDefined();
    expect(idea.title).toBe("Learn Rust");
    expect(idea.status).toBe("draft");
  });

  test("getIdea returns null for nonexistent id", () => {
    expect(store.getIdea("nope")).toBeNull();
  });

  test("updateIdeaStatus transitions correctly", () => {
    const idea = store.createIdea({
      title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1",
    });
    store.updateIdeaStatus(idea.id, "planned");
    const updated = store.getIdea(idea.id);
    expect(updated?.status).toBe("planned");
  });

  test("listIdeasByStatus filters correctly", () => {
    store.createIdea({ title: "A", description: "A", domain: "general", priority: "low", workspace_id: "ws-1" });
    store.createIdea({ title: "B", description: "B", domain: "general", priority: "low", workspace_id: "ws-1" });
    const drafts = store.listIdeasByStatus("draft");
    expect(drafts).toHaveLength(2);
  });

  test("listIdeasByWorkspace filters by workspace", () => {
    store.createIdea({ title: "A", description: "A", domain: "general", priority: "low", workspace_id: "ws-1" });
    store.createIdea({ title: "B", description: "B", domain: "general", priority: "low", workspace_id: "ws-2" });
    const ws1Ideas = store.listIdeasByWorkspace("ws-1");
    expect(ws1Ideas).toHaveLength(1);
    expect(ws1Ideas[0].title).toBe("A");
  });

  // --- Planned Tasks ---
  test("createTask inserts and returns task", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({
      idea_id: idea.id, workspace_id: "ws-1", title: "Step 1", description: "First step",
      type: "one_off", agent: "hermes", prompt: "Do step 1",
      decomposition_rationale: "Start here", scheduling_rationale: "Immediate",
    });
    expect(task.id).toBeDefined();
    expect(task.idea_id).toBe(idea.id);
    expect(task.status).toBe("pending");
  });

  test("getTasksByIdea returns tasks for an idea", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T2", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const tasks = store.getTasksByIdea(idea.id);
    expect(tasks).toHaveLength(2);
  });

  test("updateTaskStatus transitions correctly", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTaskStatus(task.id, "scheduled");
    const updated = store.getTask(task.id);
    expect(updated?.status).toBe("scheduled");
  });

  test("incrementRetryCount bumps retry_count", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.incrementRetryCount(task.id);
    const updated = store.getTask(task.id);
    expect(updated?.retry_count).toBe(1);
  });

  test("deleteTasksByIdea cascades on idea delete", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    db.getDatabase().run("DELETE FROM ideas WHERE id = ?", [idea.id]);
    expect(store.getTasksByIdea(idea.id)).toHaveLength(0);
  });

  // --- Execution Results ---
  test("addExecutionResult inserts and returns result", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const result = store.addExecutionResult({
      task_id: task.id, agent: "hermes", success: true, output: "Done", duration_ms: 500,
    });
    expect(result.id).toBeGreaterThan(0);
    expect(result.success).toBe(true);
  });

  test("getResultsByTask returns results for a task", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "OK", duration_ms: 100 });
    store.addExecutionResult({ task_id: task.id, agent: "hermes", success: false, output: "Fail", duration_ms: 200 });
    const results = store.getResultsByTask(task.id);
    expect(results).toHaveLength(2);
  });

  test("addUserFeedback updates existing result", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "OK", duration_ms: 100 });
    store.addUserFeedback(result.id, "Great work!");
    const updated = store.getResultsByTask(task.id);
    expect(updated[0].user_feedback).toBe("Great work!");
  });

  test("getResultsByIdea returns results across all tasks in an idea", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const t1 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const t2 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T2", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.addExecutionResult({ task_id: t1.id, agent: "hermes", success: true, output: "OK", duration_ms: 100 });
    store.addExecutionResult({ task_id: t2.id, agent: "hermes", success: false, output: "Fail", duration_ms: 200 });
    const results = store.getResultsByIdea(idea.id);
    expect(results).toHaveLength(2);
  });

  // --- updateTask ---
  test("updateTask updates a single field", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Original", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTask(task.id, { title: "Updated" });
    expect(store.getTask(task.id)?.title).toBe("Updated");
  });

  test("updateTask updates multiple fields", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Original", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTask(task.id, { agent: "openclaw", prompt: "New prompt" });
    const updated = store.getTask(task.id);
    expect(updated?.agent).toBe("openclaw");
    expect(updated?.prompt).toBe("New prompt");
  });

  test("updateTask with no fields is a no-op", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Original", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTask(task.id, {});
    expect(store.getTask(task.id)?.title).toBe("Original");
  });

  test("updateTask sets cron_schedule and type", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTask(task.id, { type: "cron", cron_schedule: "0 9 * * 1-5" });
    const updated = store.getTask(task.id);
    expect(updated?.type).toBe("cron");
    expect(updated?.cron_schedule).toBe("0 9 * * 1-5");
  });

  // --- deleteTask ---
  test("deleteTask removes the task", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.deleteTask(task.id);
    expect(store.getTask(task.id)).toBeNull();
  });

  test("deleteTask on nonexistent id does not error", () => {
    expect(() => store.deleteTask("nonexistent")).not.toThrow();
  });

  test("deleteTask removes only the target task", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const t1 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const t2 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T2", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.deleteTask(t1.id);
    expect(store.getTask(t1.id)).toBeNull();
    expect(store.getTask(t2.id)).toBeDefined();
    expect(store.getTasksByIdea(idea.id)).toHaveLength(1);
  });
});
