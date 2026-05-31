import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";

describe("OrchestratorStore dispatch decisions", () => {
  let db: KaiDB;
  let dbPath: string;
  let store: OrchestratorStore;

  /** Helper: create idea + task so FK constraints are satisfied. */
  function createTaskForIdea(): string {
    const idea = store.createIdea({
      title: "Dispatch Test",
      description: "Test dispatch decisions",
      domain: "general",
      priority: "medium",
      workspace_id: "ws-1",
    });
    const task = store.createTask({
      idea_id: idea.id,
      workspace_id: "ws-1",
      title: "Task for dispatch",
      description: "D",
      type: "one_off",
      agent: "claude",
      prompt: "P",
      decomposition_rationale: "R",
      scheduling_rationale: "R",
    });
    return task.id;
  }

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-store-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("createDispatchDecision + getDispatchDecision round-trip", () => {
    const taskId = createTaskForIdea();
    const id = randomUUID();
    store.createDispatchDecision({
      id,
      task_id: taskId,
      agent: "claude",
      confidence: 0.8,
      reasoning: "cold start default",
    });

    const row = store.getDispatchDecision(id);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(id);
    expect(row!.task_id).toBe(taskId);
    expect(row!.agent).toBe("claude");
    expect(row!.user_decision).toBe("pending");
  });

  test("updateDispatchDecision updates user_decision and user_reason", () => {
    const taskId = createTaskForIdea();
    const id = randomUUID();
    store.createDispatchDecision({
      id,
      task_id: taskId,
      agent: "claude",
      confidence: 0.5,
      reasoning: "test",
    });

    store.updateDispatchDecision(id, "approved", "Looks good");

    const row = store.getDispatchDecision(id);
    expect(row!.user_decision).toBe("approved");
    expect(row!.user_reason).toBe("Looks good");
  });

  test("getDispatchDecision returns null for nonexistent id", () => {
    const row = store.getDispatchDecision("nonexistent");
    expect(row).toBeNull();
  });

  test("updateDispatchDecision throws for invalid decision value", () => {
    const taskId = createTaskForIdea();
    const id = randomUUID();
    store.createDispatchDecision({
      id,
      task_id: taskId,
      agent: "claude",
      confidence: 0.7,
      reasoning: "test invalid",
    });

    // "maybe" is not in the CHECK constraint ('approved', 'rejected', 'pending')
    expect(() => {
      store.updateDispatchDecision(id, "maybe", "testing check");
    }).toThrow();
  });

  test("updateDispatchDecision updates updated_at timestamp", () => {
    const taskId = createTaskForIdea();
    const id = randomUUID();
    store.createDispatchDecision({
      id,
      task_id: taskId,
      agent: "claude",
      confidence: 0.6,
      reasoning: "test timestamp",
    });

    const before = store.getDispatchDecision(id);
    expect(before!.updated_at).toBeDefined();

    store.updateDispatchDecision(id, "approved", "timestamp check");

    const after = store.getDispatchDecision(id);
    expect(after!.updated_at).toBeDefined();
    // updated_at should be a non-empty string after the update
    expect(typeof after!.updated_at).toBe("string");
    expect((after!.updated_at as string).length).toBeGreaterThan(0);
  });
});
