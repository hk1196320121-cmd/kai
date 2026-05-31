import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KaiDB } from "../../src/db/client";
import { registerOrchestratorHandlers } from "../../src/mcp/orchestrator-handlers";
import { OrchestratorStore } from "../../src/core/orchestrator/store";
import { WorkspaceStore } from "../../src/workspace/store";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";

function setup(db: KaiDB): Record<string, any> {
  const server = new McpServer({ name: "kai-test", version: "0.0.0" });
  registerOrchestratorHandlers(server, db);
  return (server as any)._registeredTools;
}

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe("kai_dispatch_feedback", () => {
  let db: KaiDB;
  let dbPath: string;
  let registered: Record<string, any>;
  let savedLlmEnv: { apiKey: string | undefined; baseUrl: string | undefined };

  beforeEach(() => {
    savedLlmEnv = {
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_BASE_URL,
    };
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;

    dbPath = join(tmpdir(), `kai-dispatch-test-${Date.now()}.db`);
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
    if (savedLlmEnv.apiKey !== undefined) process.env.LLM_API_KEY = savedLlmEnv.apiKey;
    if (savedLlmEnv.baseUrl !== undefined) process.env.LLM_BASE_URL = savedLlmEnv.baseUrl;
  });

  // ------------------------------------------------------------------ //
  // dispatch_not_found for unknown dispatch_id
  // ------------------------------------------------------------------ //

  test("returns dispatch_not_found for unknown dispatch_id", async () => {
    const result = await registered["kai_dispatch_feedback"].handler({
      dispatch_id: "nonexistent",
      decision: "approved",
    });
    const parsed = parseResult(result);
    expect(parsed.error).toBe("dispatch_not_found");
  });

  // ------------------------------------------------------------------ //
  // approved feedback round-trip
  // ------------------------------------------------------------------ //

  test("records approved feedback for a dispatch decision", async () => {
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
      title: "Task for dispatch",
      description: "A task",
      type: "one_off",
      agent: "claude",
      prompt: "Do it",
      decomposition_rationale: "Test",
      scheduling_rationale: "Test",
    });

    // Insert a dispatch decision linked to a real task
    const dispatchId = randomUUID();
    store.createDispatchDecision({
      id: dispatchId,
      task_id: task.id,
      agent: "claude",
      confidence: 0.8,
      reasoning: "cold start default",
    });

    const result = await registered["kai_dispatch_feedback"].handler({
      dispatch_id: dispatchId,
      decision: "approved",
      reason: "Looks good",
    });
    const parsed = parseResult(result);

    expect(parsed.dispatch_id).toBe(dispatchId);
    expect(parsed.decision).toBe("approved");
    expect(parsed.recorded).toBe(true);

    // Verify DB was updated via store method
    const row = store.getDispatchDecision(dispatchId);
    expect(row!.user_decision).toBe("approved");
    expect(row!.user_reason).toBe("Looks good");
  });

  // ------------------------------------------------------------------ //
  // rejected feedback round-trip
  // ------------------------------------------------------------------ //

  test("records rejected feedback", async () => {
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
      title: "Task for dispatch",
      description: "A task",
      type: "one_off",
      agent: "claude",
      prompt: "Do it",
      decomposition_rationale: "Test",
      scheduling_rationale: "Test",
    });

    const dispatchId = randomUUID();
    store.createDispatchDecision({
      id: dispatchId,
      task_id: task.id,
      agent: "claude",
      confidence: 0.5,
      reasoning: "cold start",
    });

    const result = await registered["kai_dispatch_feedback"].handler({
      dispatch_id: dispatchId,
      decision: "rejected",
      reason: "Too broad",
    });
    const parsed = parseResult(result);

    expect(parsed.decision).toBe("rejected");
    expect(parsed.recorded).toBe(true);

    const row = store.getDispatchDecision(dispatchId);
    expect(row!.user_decision).toBe("rejected");
  });

  // ------------------------------------------------------------------ //
  // prevents double-vote on already decided dispatch
  // ------------------------------------------------------------------ //

  test("prevents double-vote on already decided dispatch", async () => {
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
      title: "Task for dispatch",
      description: "A task",
      type: "one_off",
      agent: "claude",
      prompt: "Do it",
      decomposition_rationale: "Test",
      scheduling_rationale: "Test",
    });

    const dispatchId = randomUUID();
    store.createDispatchDecision({
      id: dispatchId,
      task_id: task.id,
      agent: "claude",
      confidence: 0.8,
      reasoning: "cold start default",
    });

    // First call: approve — should succeed
    const first = await registered["kai_dispatch_feedback"].handler({
      dispatch_id: dispatchId,
      decision: "approved",
      reason: "Looks good",
    });
    const firstParsed = parseResult(first);
    expect(firstParsed.recorded).toBe(true);
    expect(firstParsed.decision).toBe("approved");

    // Second call: reject — should be blocked
    const second = await registered["kai_dispatch_feedback"].handler({
      dispatch_id: dispatchId,
      decision: "rejected",
      reason: "Changed my mind",
    });
    const secondParsed = parseResult(second);
    expect(secondParsed.error).toBe("dispatch_already_decided");

    // Verify the original decision was preserved
    const row = store.getDispatchDecision(dispatchId);
    expect(row!.user_decision).toBe("approved");
    expect(row!.user_reason).toBe("Looks good");
  });

  // ------------------------------------------------------------------ //
  // kai_task_execute: graceful error for nonexistent task
  // ------------------------------------------------------------------ //

  test("kai_task_execute handler catches internal errors gracefully", async () => {
    const result = await registered["kai_task_execute"].handler({
      task_id: "nonexistent-task",
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
  });

  // ------------------------------------------------------------------ //
  // kai_dispatch_feedback: graceful handling of empty dispatch_id
  // ------------------------------------------------------------------ //

  test("kai_dispatch_feedback handles internal error gracefully", async () => {
    const result = await registered["kai_dispatch_feedback"].handler({
      dispatch_id: "",
      decision: "approved",
    });
    const parsed = parseResult(result);
    // Empty string won't match any row — should get dispatch_not_found
    expect(parsed.error).toBeDefined();
  });
});
