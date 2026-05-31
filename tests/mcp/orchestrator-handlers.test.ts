import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KaiDB } from "../../src/db/client";
import { registerOrchestratorHandlers } from "../../src/mcp/orchestrator-handlers";
import { OrchestratorStore } from "../../src/core/orchestrator/store";
import { WorkspaceStore } from "../../src/workspace/store";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync, rmSync, existsSync } from "fs";

/**
 * Helper: create a fresh MCP server with only orchestrator handlers registered,
 * then return a map of tool-name -> registered tool object (with .handler).
 */
function setup(db: KaiDB): Record<string, any> {
  const server = new McpServer({ name: "kai-test", version: "0.0.0" });
  registerOrchestratorHandlers(server, db);
  return (server as any)._registeredTools;
}

/** Parse the JSON text from a handler result. */
function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe("Orchestrator MCP Handlers", () => {
  let db: KaiDB;
  let dbPath: string;
  let registered: Record<string, any>;
  let savedLlmEnv: { apiKey: string | undefined; baseUrl: string | undefined };

  beforeEach(() => {
    // Save and clear LLM env vars so planner falls back to single-task
    // instead of making real API calls that hang/timeout in CI.
    savedLlmEnv = {
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_BASE_URL,
    };
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;

    dbPath = join(tmpdir(), `kai-orch-handler-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    registered = setup(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {}
    }
    // Clean up any hermes pending files created during dispatch tests
    const pendingDir = join(process.env.HOME || "/tmp", ".hermes", "cron", "pending");
    if (existsSync(pendingDir)) {
      try { rmSync(pendingDir, { recursive: true }); } catch {}
    }

    // Restore LLM env vars
    if (savedLlmEnv.apiKey !== undefined) process.env.LLM_API_KEY = savedLlmEnv.apiKey;
    if (savedLlmEnv.baseUrl !== undefined) process.env.LLM_BASE_URL = savedLlmEnv.baseUrl;
  });

  // ------------------------------------------------------------------ //
  // kai_idea_submit
  // ------------------------------------------------------------------ //

  test("kai_idea_submit: creates idea with workspace_id, returns idea_id and status", async () => {
    const store = new OrchestratorStore(db);
    const wsStore = new WorkspaceStore(db);
    const ws = wsStore.createWorkspace({ name: "Test WS" });

    const result = await registered["kai_idea_submit"].handler({
      title: "Learn TypeScript",
      description: "Master TypeScript generics and utility types",
      domain: "coding",
      priority: "high",
      workspace_id: ws.id,
    });
    const parsed = parseResult(result);

    expect(parsed.idea_id).toBeDefined();
    expect(parsed.workspace_id).toBe(ws.id);
    expect(parsed.status).toBe("draft");
    expect(parsed.suggested_clusters).toBeDefined();

    // Verify the idea was persisted
    const idea = store.getIdea(parsed.idea_id);
    expect(idea).not.toBeNull();
    expect(idea!.title).toBe("Learn TypeScript");
  });

  test("kai_idea_submit: auto-creates workspace when workspace_id omitted", async () => {
    const result = await registered["kai_idea_submit"].handler({
      title: "My Great Idea",
      description: "Something amazing",
      domain: "general",
      priority: "medium",
    });
    const parsed = parseResult(result);

    expect(parsed.idea_id).toBeDefined();
    expect(parsed.workspace_id).toBeDefined();
    expect(parsed.workspace_id).not.toBe("");
    expect(parsed.status).toBe("draft");

    // Verify workspace was created
    const wsStore = new WorkspaceStore(db);
    const ws = wsStore.getWorkspace(parsed.workspace_id);
    expect(ws).not.toBeNull();
  });

  // ------------------------------------------------------------------ //
  // kai_idea_plan
  // ------------------------------------------------------------------ //

  test("kai_idea_plan: returns idea_not_found for missing idea", async () => {
    const result = await registered["kai_idea_plan"].handler({
      idea_id: "nonexistent-id",
    });
    const parsed = parseResult(result);
    expect(parsed.error).toBe("idea_not_found");
  });

  // ------------------------------------------------------------------ //
  // kai_plan_approve
  // ------------------------------------------------------------------ //

  test("kai_plan_approve: schedules tasks for an idea", async () => {
    // Submit an idea first (creates workspace + idea)
    const submitResult = await registered["kai_idea_submit"].handler({
      title: "Test Idea",
      description: "A test idea for approval",
      domain: "general",
      priority: "medium",
    });
    const { idea_id, workspace_id } = parseResult(submitResult);

    // Create tasks manually (simulating a plan step) so scheduler has pending tasks
    const store = new OrchestratorStore(db);
    store.createTask({
      idea_id,
      workspace_id,
      title: "Task 1",
      description: "First task",
      type: "one_off",
      agent: "hermes",
      prompt: "Do task 1",
      decomposition_rationale: "Test",
      scheduling_rationale: "Test",
    });
    store.updateIdeaStatus(idea_id, "planned");

    const result = await registered["kai_plan_approve"].handler({
      idea_id,
    });
    const parsed = parseResult(result);

    expect(parsed.scheduled_tasks).toBeGreaterThanOrEqual(1);
    expect(parsed.errors).toBe(0);
    expect(parsed.tasks).toBeDefined();
    expect(parsed.tasks.length).toBeGreaterThanOrEqual(1);
    expect(parsed.tasks[0].status).toBe("scheduled");
  });

  test("kai_plan_approve: returns unsupported_action for 'add' modification", async () => {
    // Submit an idea
    const submitResult = await registered["kai_idea_submit"].handler({
      title: "Modification Test",
      description: "Test add modification rejection",
      domain: "general",
      priority: "medium",
    });
    const { idea_id } = parseResult(submitResult);

    const result = await registered["kai_plan_approve"].handler({
      idea_id,
      task_modifications: [{ action: "add" }],
    });
    const parsed = parseResult(result);

    expect(parsed.error).toBe("unsupported_action");
    expect(parsed.message).toContain("add");
  });

  test("kai_plan_approve: returns task_not_found when task_id belongs to different idea", async () => {
    // Create two ideas
    const sub1 = await registered["kai_idea_submit"].handler({
      title: "Idea A",
      description: "First idea",
      domain: "general",
      priority: "medium",
    });
    const ideaA = parseResult(sub1);

    const sub2 = await registered["kai_idea_submit"].handler({
      title: "Idea B",
      description: "Second idea",
      domain: "general",
      priority: "medium",
    });
    const ideaB = parseResult(sub2);

    // Create a task under idea B
    const store = new OrchestratorStore(db);
    const task = store.createTask({
      idea_id: ideaB.idea_id,
      workspace_id: ideaB.workspace_id,
      title: "Task for B",
      description: "Belongs to idea B",
      type: "one_off",
      agent: "hermes",
      prompt: "Do something",
      decomposition_rationale: "Test",
      scheduling_rationale: "Test",
    });

    // Try to modify idea B's task from idea A's approve
    const result = await registered["kai_plan_approve"].handler({
      idea_id: ideaA.idea_id,
      task_modifications: [
        { task_id: task.id, action: "update", field: "title", value: "Hacked" },
      ],
    });
    const parsed = parseResult(result);

    expect(parsed.error).toBe("task_not_found");
    expect(parsed.message).toContain(task.id);
    expect(parsed.message).toContain(ideaA.idea_id);
  });

  // ------------------------------------------------------------------ //
  // kai_task_execute
  // ------------------------------------------------------------------ //

  test("kai_task_execute: dispatches one_off task successfully", async () => {
    const store = new OrchestratorStore(db);
    const wsStore = new WorkspaceStore(db);
    const ws = wsStore.createWorkspace({ name: "WS" });
    const idea = store.createIdea({
      title: "T",
      description: "D",
      domain: "general",
      priority: "medium",
      workspace_id: ws.id,
    });
    const task = store.createTask({
      idea_id: idea.id,
      workspace_id: ws.id,
      title: "Dispatchable",
      description: "A one_off task",
      type: "one_off",
      agent: "hermes",
      prompt: "Do the thing",
      decomposition_rationale: "Test",
      scheduling_rationale: "Test",
    });

    const result = await registered["kai_task_execute"].handler({
      task_id: task.id,
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.task_id).toBe(task.id);
    expect(parsed.agent).toBe(task.agent);
    expect(parsed.error).toBeUndefined();
  });

  test("kai_task_execute: rejects cron task", async () => {
    const store = new OrchestratorStore(db);
    const wsStore = new WorkspaceStore(db);
    const ws = wsStore.createWorkspace({ name: "WS" });
    const idea = store.createIdea({
      title: "T",
      description: "D",
      domain: "general",
      priority: "medium",
      workspace_id: ws.id,
    });
    const task = store.createTask({
      idea_id: idea.id,
      workspace_id: ws.id,
      title: "Daily cron",
      description: "A cron task",
      type: "cron",
      agent: "hermes",
      prompt: "Daily digest",
      cron_schedule: "0 9 * * *",
      decomposition_rationale: "Test",
      scheduling_rationale: "Test",
    });

    const result = await registered["kai_task_execute"].handler({
      task_id: task.id,
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Cron tasks must be scheduled");
  });

  // ------------------------------------------------------------------ //
  // kai_idea_pause
  // ------------------------------------------------------------------ //

  test("kai_idea_pause: pauses tasks for an idea", async () => {
    const store = new OrchestratorStore(db);
    const wsStore = new WorkspaceStore(db);
    const ws = wsStore.createWorkspace({ name: "WS" });
    const idea = store.createIdea({
      title: "T",
      description: "D",
      domain: "general",
      priority: "medium",
      workspace_id: ws.id,
    });
    const task = store.createTask({
      idea_id: idea.id,
      workspace_id: ws.id,
      title: "Task",
      description: "D",
      type: "one_off",
      agent: "hermes",
      prompt: "P",
      decomposition_rationale: "R",
      scheduling_rationale: "R",
    });
    store.updateTaskStatus(task.id, "scheduled");

    const result = await registered["kai_idea_pause"].handler({
      idea_id: idea.id,
    });
    const parsed = parseResult(result);

    expect(parsed.paused_tasks).toBeGreaterThanOrEqual(1);
    expect(parsed.cancelled_cron_jobs).toBe(0);

    // Verify task is now paused
    const updated = store.getTask(task.id);
    expect(updated!.status).toBe("paused");
  });

  // ------------------------------------------------------------------ //
  // kai_execution_status
  // ------------------------------------------------------------------ //

  test("kai_execution_status: returns results by idea_id", async () => {
    const store = new OrchestratorStore(db);
    const wsStore = new WorkspaceStore(db);
    const ws = wsStore.createWorkspace({ name: "WS" });
    const idea = store.createIdea({
      title: "T",
      description: "D",
      domain: "general",
      priority: "medium",
      workspace_id: ws.id,
    });
    const task = store.createTask({
      idea_id: idea.id,
      workspace_id: ws.id,
      title: "Task",
      description: "D",
      type: "one_off",
      agent: "hermes",
      prompt: "P",
      decomposition_rationale: "R",
      scheduling_rationale: "R",
    });
    store.addExecutionResult({
      task_id: task.id,
      agent: "hermes",
      success: true,
      output: "Done",
      duration_ms: 500,
    });

    const result = await registered["kai_execution_status"].handler({
      idea_id: idea.id,
    });
    const parsed = parseResult(result);

    expect(parsed.tasks).toBeDefined();
    expect(parsed.tasks.length).toBeGreaterThanOrEqual(1);
    expect(parsed.results).toBeDefined();
    expect(parsed.results.length).toBeGreaterThanOrEqual(1);
    expect(parsed.results[0].success).toBe(true);
    expect(parsed.results[0].duration_ms).toBe(500);
    expect(parsed.profile_updates).toBeDefined();
  });

  test("kai_execution_status: with no idea_id/task_id returns empty", async () => {
    const result = await registered["kai_execution_status"].handler({});
    const parsed = parseResult(result);

    expect(parsed.tasks).toEqual([]);
    expect(parsed.results).toEqual([]);
    expect(parsed.profile_updates).toEqual([]);
  });

  test("kai_execution_status: with feedback when no results exist does not throw", async () => {
    const store = new OrchestratorStore(db);
    const wsStore = new WorkspaceStore(db);
    const ws = wsStore.createWorkspace({ name: "WS" });
    const idea = store.createIdea({
      title: "T",
      description: "D",
      domain: "general",
      priority: "medium",
      workspace_id: ws.id,
    });

    // Call with feedback but no results yet - should not throw, just no-op
    const result = await registered["kai_execution_status"].handler({
      idea_id: idea.id,
      feedback: "Looks good so far",
    });
    const parsed = parseResult(result);

    expect(parsed.tasks).toEqual([]);
    expect(parsed.results).toEqual([]);
    expect(parsed.profile_updates).toBeDefined();
  });

  // ------------------------------------------------------------------ //
  // kai_replan
  // ------------------------------------------------------------------ //

  test("kai_replan: creates new plan and deletes old non-terminal tasks", async () => {
    const store = new OrchestratorStore(db);
    const wsStore = new WorkspaceStore(db);
    const ws = wsStore.createWorkspace({ name: "WS" });
    const idea = store.createIdea({
      title: "Replan Idea",
      description: "Need to replan this",
      domain: "general",
      priority: "medium",
      workspace_id: ws.id,
    });

    // Create tasks with mixed statuses
    const t1 = store.createTask({
      idea_id: idea.id,
      workspace_id: ws.id,
      title: "Old pending",
      description: "Should be deleted",
      type: "one_off",
      agent: "hermes",
      prompt: "P",
      decomposition_rationale: "R",
      scheduling_rationale: "R",
    });
    store.updateTaskStatus(t1.id, "scheduled");

    const t2 = store.createTask({
      idea_id: idea.id,
      workspace_id: ws.id,
      title: "Already done",
      description: "Should survive replan",
      type: "one_off",
      agent: "hermes",
      prompt: "P",
      decomposition_rationale: "R",
      scheduling_rationale: "R",
    });
    store.updateTaskStatus(t2.id, "completed");

    store.updateIdeaStatus(idea.id, "planned");

    const result = await registered["kai_replan"].handler({
      idea_id: idea.id,
    });
    const parsed = parseResult(result);

    // New plan should contain tasks from the fallback planner
    expect(parsed.new_plan).toBeDefined();
    expect(parsed.new_plan.length).toBeGreaterThanOrEqual(1);
    expect(parsed.changes_from_previous).toBeDefined();
    expect(parsed.changes_from_previous.old_count).toBe(2);
    expect(parsed.changes_from_previous.new_count).toBeGreaterThanOrEqual(1);

    // Verify old non-terminal task was deleted
    expect(store.getTask(t1.id)).toBeNull();
    // Verify completed task survived
    expect(store.getTask(t2.id)).not.toBeNull();
  });

  test("kai_replan: returns idea_not_found for missing idea", async () => {
    const result = await registered["kai_replan"].handler({
      idea_id: "nonexistent-id",
    });
    const parsed = parseResult(result);
    expect(parsed.error).toBe("idea_not_found");
  });
});
