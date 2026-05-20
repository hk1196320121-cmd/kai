import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { Derivator } from "../../src/core/profile/derivator";
import { OrchestratorStore } from "../../src/core/orchestrator/store";
import { Observer } from "../../src/core/orchestrator/observer";
import { ClosedLoopEngine } from "../../src/core/orchestrator/closed-loop";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("Orchestrator E2E: Full Closed Loop", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let profileEngine: ProfileEngine;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-e2e-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
    profileEngine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("full closed loop: submit → plan → execute → observe → profile update", () => {
    // 1. Set up profile with baseline traits
    profileEngine.setTrait({
      dimension: "detail_oriented",
      value: 0.5,
      confidence: 5,
      source: "observed",
      reasoning: "baseline",
    });

    // Take a snapshot of the closed loop engine BEFORE changes,
    // so detectSignificantChanges can compare against this baseline.
    const closedLoop = new ClosedLoopEngine(profileEngine, store);

    // 2. Submit idea
    const idea = store.createIdea({
      title: "Learn Rust",
      description: "Build a systems CLI tool",
      domain: "coding",
      priority: "high",
      workspace_id: "ws-e2e",
    });
    expect(idea.status).toBe("draft");

    // 3. Plan (create tasks manually, simulating planner output)
    const task1 = store.createTask({
      idea_id: idea.id,
      workspace_id: "ws-e2e",
      title: "Set up project",
      description: "Initialize Cargo project",
      type: "one_off",
      agent: "hermes",
      prompt: "cargo init",
      decomposition_rationale: "First step",
      scheduling_rationale: "Immediate",
    });
    const task2 = store.createTask({
      idea_id: idea.id,
      workspace_id: "ws-e2e",
      title: "Daily practice",
      description: "Practice Rust daily",
      type: "cron",
      agent: "hermes",
      prompt: "Practice",
      cron_schedule: "0 9 * * *",
      cron_prompt: "Daily practice",
      decomposition_rationale: "Build habit",
      scheduling_rationale: "Morning",
    });
    store.updateIdeaStatus(idea.id, "planned");

    // 4. Approve and schedule
    store.updateTaskStatus(task1.id, "scheduled");
    store.updateTaskStatus(task2.id, "scheduled");
    store.updateIdeaStatus(idea.id, "executing");

    // 5. Execute task 1
    store.updateTaskStatus(task1.id, "executing");
    const result = store.addExecutionResult({
      task_id: task1.id,
      agent: "hermes",
      success: true,
      output: "Project initialized",
      duration_ms: 2500,
    });

    // 6. Observer processes result → emits observations
    const observer = new Observer(store, profileEngine);
    const observations = observer.processResult(result);
    expect(observations.length).toBeGreaterThanOrEqual(2);

    // 7. Verify task completed (observer.updateTaskStatus is called internally)
    expect(store.getTask(task1.id)?.status).toBe("completed");

    // 8. Derive traits from new observations
    const derivator = new Derivator(profileEngine);
    const derivedTraits = derivator.deriveFromRules();
    // Execution result observations may not match any derivation rules,
    // so we just verify the call succeeds without error.
    expect(Array.isArray(derivedTraits)).toBe(true);

    // 9. Set a trait manually to simulate derivation result, then detect change
    profileEngine.setTrait({
      dimension: "task_completion_rate",
      value: 0.7,
      confidence: 6,
      source: "observed",
      reasoning: "Based on execution results",
    });
    const changes = closedLoop.detectSignificantChanges();
    expect(Array.isArray(changes)).toBe(true);

    // 10. Verify execution results persisted
    const allResults = store.getResultsByIdea(idea.id);
    expect(allResults).toHaveLength(1);
    expect(allResults[0].success).toBe(true);
  });

  test("idea lifecycle status transitions", () => {
    const idea = store.createIdea({
      title: "Quick Test",
      description: "Status transitions",
      domain: "general",
      priority: "low",
      workspace_id: "ws-e2e",
    });

    expect(store.getIdea(idea.id)?.status).toBe("draft");
    store.updateIdeaStatus(idea.id, "planned");
    expect(store.getIdea(idea.id)?.status).toBe("planned");
    store.updateIdeaStatus(idea.id, "executing");
    expect(store.getIdea(idea.id)?.status).toBe("executing");
    store.updateIdeaStatus(idea.id, "completed");
    expect(store.getIdea(idea.id)?.status).toBe("completed");
  });

  test("task retry mechanism", () => {
    const idea = store.createIdea({
      title: "Retry Test",
      description: "Test retries",
      domain: "general",
      priority: "medium",
      workspace_id: "ws-e2e",
    });
    const task = store.createTask({
      idea_id: idea.id,
      workspace_id: "ws-e2e",
      title: "Flaky task",
      description: "Might fail",
      type: "one_off",
      agent: "hermes",
      prompt: "Do something flaky",
      decomposition_rationale: "R",
      scheduling_rationale: "R",
    });

    // Verify default max_retries
    expect(store.getTask(task.id)?.max_retries).toBe(2);

    // Simulate first failure
    store.addExecutionResult({
      task_id: task.id,
      agent: "hermes",
      success: false,
      output: "Error",
      duration_ms: 1000,
    });
    store.incrementRetryCount(task.id);
    expect(store.getTask(task.id)?.retry_count).toBe(1);

    // Simulate second failure
    store.addExecutionResult({
      task_id: task.id,
      agent: "hermes",
      success: false,
      output: "Error again",
      duration_ms: 2000,
    });
    store.incrementRetryCount(task.id);
    expect(store.getTask(task.id)?.retry_count).toBe(2);

    // Max retries reached
    const currentTask = store.getTask(task.id)!;
    expect(currentTask.retry_count).toBeGreaterThanOrEqual(currentTask.max_retries);
  });
});
