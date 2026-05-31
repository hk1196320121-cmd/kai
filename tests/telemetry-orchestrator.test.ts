import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { TelemetryRecorder } from "../src/core/telemetry/recorder";
import { Dispatcher } from "../src/core/orchestrator/dispatcher";
import { Observer } from "../src/core/orchestrator/observer";
import { Planner } from "../src/core/orchestrator/planner";
import { Derivator } from "../src/core/profile/derivator";
import { ProfileEngine } from "../src/core/profile/engine";
import { OrchestratorStore } from "../src/core/orchestrator/store";
import type { AgentBridge } from "../src/bridge/agent-bridge";
import type { LLMProvider } from "../src/llm/provider";

describe("Orchestrator Telemetry", () => {
  let db: KaiDB;
  let telStore: TelemetryStore;
  let recorder: TelemetryRecorder;
  let orchStore: OrchestratorStore;
  let engine: ProfileEngine;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-orch-tel-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    telStore = new TelemetryStore(db);
    recorder = new TelemetryRecorder(telStore);
    orchStore = new OrchestratorStore(db);
    engine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  // --- Dispatcher ---

  test("dispatcher.dispatch telemetry: success span.end(ok)", async () => {
    const idea = orchStore.createIdea({
      title: "test", description: "desc", workspace_id: "ws1",
    });
    const task = orchStore.createTask({
      idea_id: idea.id, workspace_id: "ws1",
      title: "t", description: "d", type: "one_off",
      agent: "hermes", prompt: "do it",
      decomposition_rationale: "test", scheduling_rationale: "test",
    });

    const bridge = {
      dispatchOneOff: async () => ({ success: true, agent: "hermes", jobId: "j1" }),
    } as unknown as AgentBridge;

    const dispatcher = new Dispatcher(orchStore, bridge, recorder);
    await dispatcher.dispatch(task.id);

    const traces = telStore.queryTelemetry(
      "SELECT * FROM runtime_traces WHERE tool_name = 'dispatcher.dispatch'",
    );
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("completed");

    const spans = telStore.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'task_exec'",
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("ok");
  });

  test("dispatcher.dispatch telemetry: task not found span.end(error)", async () => {
    const bridge = {
      dispatchOneOff: async () => ({ success: false, agent: "hermes" }),
    } as unknown as AgentBridge;

    const dispatcher = new Dispatcher(orchStore, bridge, recorder);
    const result = await dispatcher.dispatch("nonexistent-id");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Task not found");

    const spans = telStore.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'task_exec'",
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("error");
  });

  test("dispatcher.dispatch telemetry: task already done span.end(error)", async () => {
    const idea = orchStore.createIdea({
      title: "test", description: "desc", workspace_id: "ws1",
    });
    const task = orchStore.createTask({
      idea_id: idea.id, workspace_id: "ws1",
      title: "t", description: "d", type: "one_off",
      agent: "hermes", prompt: "do it",
      decomposition_rationale: "test", scheduling_rationale: "test",
    });
    orchStore.updateTaskStatus(task.id, "completed");

    const bridge = {
      dispatchOneOff: async () => ({ success: true, agent: "hermes", jobId: "j1" }),
    } as unknown as AgentBridge;

    const dispatcher = new Dispatcher(orchStore, bridge, recorder);
    const result = await dispatcher.dispatch(task.id);

    expect(result.error).toContain("completed");

    const spans = telStore.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'task_exec'",
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("error");
  });

  test("dispatcher.dispatch telemetry: max retries exceeded span.end(error)", async () => {
    const idea = orchStore.createIdea({
      title: "test", description: "desc", workspace_id: "ws1",
    });
    const task = orchStore.createTask({
      idea_id: idea.id, workspace_id: "ws1",
      title: "t", description: "d", type: "one_off",
      agent: "hermes", prompt: "do it",
      decomposition_rationale: "test", scheduling_rationale: "test",
    });
    // Increment retry count to max (default 3)
    for (let i = 0; i < 3; i++) {
      orchStore.incrementRetryCount(task.id);
    }

    const bridge = {
      dispatchOneOff: async () => ({ success: true, agent: "hermes", jobId: "j1" }),
    } as unknown as AgentBridge;

    const dispatcher = new Dispatcher(orchStore, bridge, recorder);
    const result = await dispatcher.dispatch(task.id);

    expect(result.error).toBe("Max retries exceeded");

    const spans = telStore.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'task_exec'",
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("error");
  });

  // --- Observer ---

  test("observer.processResult telemetry: success span.end(ok)", () => {
    const observer = new Observer(orchStore, engine, recorder);

    const idea = orchStore.createIdea({
      title: "test", description: "desc", workspace_id: "ws1",
    });
    const task = orchStore.createTask({
      idea_id: idea.id, workspace_id: "ws1",
      title: "t", description: "d", type: "one_off",
      agent: "hermes", prompt: "do it",
      decomposition_rationale: "test", scheduling_rationale: "test",
    });

    const result = orchStore.addExecutionResult({
      task_id: task.id, agent: "hermes", success: true,
      output: "done", duration_ms: 100,
    });

    observer.processResult(result, {
      task, idea, ideaResults: [result],
    });

    const traces = telStore.queryTelemetry(
      "SELECT * FROM runtime_traces WHERE tool_name = 'observer.processResult'",
    );
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("completed");

    const spans = telStore.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'task_exec'",
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("ok");
  });

  test("observer.processResult telemetry: catch rethrow span.error", () => {
    const observer = new Observer(orchStore, engine, recorder);

    // Use a result with a task_id that doesn't map to a real task,
    // but make the engine.addObservation throw by using a broken engine
    const brokenEngine = {
      addObservation: () => { throw new Error("engine broken"); },
    } as unknown as ProfileEngine;

    const brokenObserver = new Observer(orchStore, brokenEngine, recorder);

    expect(() =>
      brokenObserver.processResult({
        id: 1, task_id: "fake", agent: "hermes",
        success: true, output: "x", duration_ms: 10,
        completed_at: new Date().toISOString(),
      })
    ).toThrow("engine broken");

    const spans = telStore.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'task_exec' AND status = 'error'",
    );
    expect(spans).toHaveLength(1);
  });

  // --- Planner ---

  test("planner.decomposeIdea telemetry: idea not found span.end(error)", async () => {
    const llm = {
      call: async () => ({}),
      getConfig: () => ({ apiKey: "test" }),
      validateWithSchema: () => {},
    } as unknown as LLMProvider;

    const planner = new Planner(orchStore, llm, undefined, recorder);

    expect(planner.decomposeIdea("nonexistent-id", [])).rejects.toThrow(
      "Idea not found",
    );

    // Allow async telemetry to flush
    await new Promise((r) => setTimeout(r, 10));

    const spans = telStore.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'task_exec' AND status = 'error'",
    );
    expect(spans).toHaveLength(1);
  });

  // --- Derivator ---

  test("derivator deriveFromRules telemetry: success span.end(ok)", () => {
    // Add an observation that matches a rule
    engine.addObservation({
      type: "signal",
      key: "cron:job1",
      value: JSON.stringify({ contentLength: 100 }),
      confidence: 5,
      source: "cron_output",
      provenance: "{}",
    });

    const derivator = new Derivator(engine, recorder);
    const results = derivator.deriveFromRules();

    expect(results.length).toBeGreaterThan(0);

    const traces = telStore.queryTelemetry(
      "SELECT * FROM runtime_traces WHERE tool_name = 'derive.rules'",
    );
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("completed");

    const spans = telStore.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'derivation'",
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("ok");
  });

  test("derivator deriveFromRules telemetry: error rethrow", () => {
    const brokenEngine = {
      getObservations: () => { throw new Error("obs fail"); },
      isCorrected: () => false,
    } as unknown as ProfileEngine;

    const derivator = new Derivator(brokenEngine, recorder);

    expect(() => derivator.deriveFromRules()).toThrow("obs fail");

    const spans = telStore.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'derivation' AND status = 'error'",
    );
    expect(spans).toHaveLength(1);
  });

  test("derivator deriveFromLLM telemetry: success with stateChange", async () => {
    engine.addObservation({
      type: "signal",
      key: "cron:job1",
      value: JSON.stringify({ contentLength: 100 }),
      confidence: 5,
      source: "cron_output",
      provenance: "{}",
    });

    const llm = {
      call: async () => ({
        traits: [{
          dimension: "tinkerer",
          value: 0.8,
          confidence: 7,
          reasoning: "observed cron activity",
        }],
      }),
      getConfig: () => ({ apiKey: "test" }),
      validateWithSchema: () => {},
    } as unknown as LLMProvider;

    const derivator = new Derivator(engine, recorder);
    const results = await derivator.deriveFromLLM(llm);

    expect(results).toHaveLength(1);
    expect(results[0].dimension).toBe("tinkerer");

    const changes = telStore.queryTelemetry(
      "SELECT * FROM runtime_state_changes WHERE entity_type = 'trait'",
    );
    expect(changes).toHaveLength(1);

    const traces = telStore.queryTelemetry(
      "SELECT * FROM runtime_traces WHERE tool_name = 'derive.llm'",
    );
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("completed");
  });
});
