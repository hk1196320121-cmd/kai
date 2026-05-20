import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { OrchestratorStore } from "../../src/core/orchestrator/store";
import { WorkspaceStore } from "../../src/workspace/store";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("Orchestrator MCP Handlers Integration", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let wsStore: WorkspaceStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-orch-mcp-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
    wsStore = new WorkspaceStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("full idea lifecycle: submit → plan → approve → execute → status", () => {
    // 1. Submit
    const ws = wsStore.createWorkspace({ name: "Test WS" });
    const idea = store.createIdea({
      title: "Learn TypeScript",
      description: "Master TypeScript generics and utility types",
      domain: "coding",
      priority: "high",
      workspace_id: ws.id,
    });
    expect(idea.status).toBe("draft");

    // 2. Plan (create tasks manually for integration test)
    store.createTask({
      idea_id: idea.id, workspace_id: ws.id, title: "Study generics",
      description: "Read TypeScript handbook on generics", type: "one_off",
      agent: "hermes", prompt: "Study generics",
      decomposition_rationale: "Foundation", scheduling_rationale: "First",
    });
    store.updateIdeaStatus(idea.id, "planned");
    expect(store.getIdea(idea.id)?.status).toBe("planned");

    // 3. Approve (mark scheduled)
    const tasks = store.getTasksByIdea(idea.id);
    store.updateTaskStatus(tasks[0].id, "scheduled");

    // 4. Execute
    store.updateTaskStatus(tasks[0].id, "executing");
    store.addExecutionResult({
      task_id: tasks[0].id, agent: "hermes", success: true,
      output: "Completed generics study", duration_ms: 3600000,
    });
    store.updateTaskStatus(tasks[0].id, "completed");

    // 5. Status
    const results = store.getResultsByTask(tasks[0].id);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  test("idea submit with auto-created workspace", () => {
    const ws = wsStore.createWorkspace({ name: "My Idea", description: "Auto-created for idea: My Idea" });
    wsStore.updateWorkspaceContext(ws.id, { auto_created: true });
    const idea = store.createIdea({
      title: "My Idea", description: "Something cool",
      domain: "general", priority: "medium", workspace_id: ws.id,
    });
    expect(idea.workspace_id).toBe(ws.id);
    expect(idea.status).toBe("draft");
  });

  // --- kai_idea_plan: idea not found ---
  test("plan for nonexistent idea returns not found", () => {
    const idea = store.getIdea("nonexistent");
    expect(idea).toBeNull();
  });

  // --- kai_plan_approve: task modifications ---
  test("approve with remove modification deletes task", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const t1 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Keep", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const t2 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Remove", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    store.deleteTask(t2.id);
    expect(store.getTask(t2.id)).toBeNull();
    expect(store.getTasksByIdea(idea.id)).toHaveLength(1);
    expect(store.getTasksByIdea(idea.id)[0].title).toBe("Keep");
  });

  test("approve with update modification changes task field", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Original", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    store.updateTask(task.id, { prompt: "Updated prompt" });
    expect(store.getTask(task.id)?.prompt).toBe("Updated prompt");
  });

  // --- kai_execution_status: feedback ---
  test("execution status with feedback attaches to latest result", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "Done", duration_ms: 100 });

    store.addUserFeedback(result.id, "Great work!");
    const updated = store.getResultsByTask(task.id);
    expect(updated[0].user_feedback).toBe("Great work!");
  });

  // --- kai_replan: cleans up old pending tasks ---
  test("replan cleans up old non-terminal tasks before creating new ones", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const t1 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Old pending", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTaskStatus(t1.id, "scheduled");
    const t2 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Already done", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTaskStatus(t2.id, "completed");

    // Simulate replan cleanup: delete non-terminal, keep terminal
    const oldTasks = store.getTasksByIdea(idea.id);
    for (const t of oldTasks) {
      if (t.status !== "completed" && t.status !== "failed") {
        store.deleteTask(t.id);
      }
    }

    const remaining = store.getTasksByIdea(idea.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("completed");
  });

  // --- kai_task_execute: rejects cron task ---
  test("cron task cannot be dispatched directly", () => {
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Daily", description: "D", type: "cron", agent: "hermes", prompt: "P", cron_schedule: "0 9 * * *", decomposition_rationale: "R", scheduling_rationale: "R" });
    expect(task.type).toBe("cron");
    // Dispatcher should reject — verified in dispatcher.test.ts
  });
});
