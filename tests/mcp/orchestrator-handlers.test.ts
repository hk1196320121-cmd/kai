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
});
