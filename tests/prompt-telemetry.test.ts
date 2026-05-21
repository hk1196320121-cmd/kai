import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { TelemetryRecorder } from "../src/core/telemetry/recorder";
import { TournamentRunner } from "../src/core/prompt/tournament-runner";
import { JudgeEngine } from "../src/core/prompt/judge-engine";
import { GeneStore } from "../src/core/prompt/gene-store";
import type { LLMProvider } from "../src/llm/provider";

describe("Prompt Telemetry", () => {
  let db: KaiDB;
  let telStore: TelemetryStore;
  let recorder: TelemetryRecorder;
  let geneStore: GeneStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-prompt-tel-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    telStore = new TelemetryStore(db);
    recorder = new TelemetryRecorder(telStore);
    geneStore = new GeneStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  // --- TournamentRunner ---

  test("tournament-runner telemetry: success with early return (no eval cases)", async () => {
    const llm = {
      call: async () => ({}),
      getConfig: () => ({ apiKey: "test" }),
      validateWithSchema: () => {},
    } as unknown as LLMProvider;

    const runner = new TournamentRunner(geneStore, llm, recorder);
    const result = await runner.run({
      task: "planner",
      segment_id: "seg1",
      model: "gpt-4",
    });

    expect(result.error).toBe("no eval cases in pool");

    const traces = telStore.queryTelemetry(
      "SELECT * FROM runtime_traces WHERE tool_name = 'tournament.run'",
    );
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("completed");

    const spans = telStore.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'genome_evolve'",
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("ok");
  });

  test("tournament-runner telemetry: early return when insufficient variants", async () => {
    const llm = {
      call: async () => ({}),
      getConfig: () => ({ apiKey: "test" }),
      validateWithSchema: () => {},
    } as unknown as LLMProvider;

    // Schema seeds a default genome with only 1 variant for "planner"
    // Add eval case to pass first check, then genome is found but <2 variants
    geneStore.createEvalCase({
      task: "planner",
      input: "test input",
    });

    const runner = new TournamentRunner(geneStore, llm, recorder);
    const result = await runner.run({
      task: "planner",
      segment_id: "seg1",
      model: "gpt-4",
    });

    expect(result.error).toBe("need at least 2 variants");

    const traces = telStore.queryTelemetry(
      "SELECT * FROM runtime_traces WHERE tool_name = 'tournament.run'",
    );
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("completed");
  });

  // --- JudgeEngine ---

  test("judge-engine telemetryScore returns 0.5 with no store", () => {
    const llm = {} as unknown as LLMProvider;
    const judge = new JudgeEngine(llm, null);
    expect(judge.telemetryScore()).toBe(0.5);
  });

  test("judge-engine telemetryScore returns >0.5 with data (no errors)", () => {
    const llm = {} as unknown as LLMProvider;

    // Insert traces with no errors
    telStore.insertTrace({
      id: "j1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    telStore.insertTrace({
      id: "j2", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });

    const judge = new JudgeEngine(llm, telStore);
    const score = judge.telemetryScore();
    expect(score).toBeGreaterThan(0.5);
  });

  test("judge-engine telemetryScore returns 0.5 fallback on query error", () => {
    const llm = {} as unknown as LLMProvider;
    const brokenStore = {
      queryTelemetry: () => { throw new Error("db down"); },
    } as unknown as TelemetryStore;

    const judge = new JudgeEngine(llm, brokenStore);
    expect(judge.telemetryScore()).toBe(0.5);
  });
});
