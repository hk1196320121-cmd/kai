/**
 * Shared test helpers for orchestrator tests.
 * Provides temp DB lifecycle and common task/idea creation utilities.
 */
import { beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { OrchestratorStore } from "../../src/core/orchestrator/store";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

export interface TempStoreContext {
  db: KaiDB;
  store: OrchestratorStore;
  dbPath: string;
}

/** Set up beforeEach/afterEach for a temp DB + OrchestratorStore. Returns a reactive object. */
export function useTempStore(): TempStoreContext {
  const ctx: TempStoreContext = {} as TempStoreContext;

  beforeEach(() => {
    ctx.dbPath = join(tmpdir(), `kai-test-${Date.now()}.db`);
    ctx.db = new KaiDB(ctx.dbPath);
    ctx.store = new OrchestratorStore(ctx.db);
  });

  afterEach(() => {
    ctx.db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(ctx.dbPath + suffix);
      } catch {}
    }
  });

  return ctx;
}

/** Create an idea + task pair with sensible defaults. Returns the task. */
export function createTestTask(
  store: OrchestratorStore,
  overrides?: {
    type?: "one_off" | "cron";
    agent?: string;
    prompt?: string;
    status?: string;
  },
) {
  const idea = store.createIdea({
    title: "Test Idea",
    description: "Test description",
    domain: "general",
    priority: "medium",
    workspace_id: "ws-1",
  });
  const task = store.createTask({
    idea_id: idea.id,
    workspace_id: "ws-1",
    title: "Test Task",
    description: "Test task",
    type: overrides?.type ?? "one_off",
    agent: overrides?.agent ?? "hermes",
    prompt: overrides?.prompt ?? "Test prompt",
    decomposition_rationale: "Test decomposition",
    scheduling_rationale: "Test scheduling",
  });
  if (overrides?.status) {
    store.updateTaskStatus(task.id, overrides.status);
  }
  return task;
}
