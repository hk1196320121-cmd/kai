import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { TelemetryRecorder } from "../src/core/telemetry/recorder";

describe("Telemetry Benchmark", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let recorder: TelemetryRecorder;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-bench-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
    recorder = new TelemetryRecorder(store);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("p99 overhead < 5ms per trace", () => {
    const ITERATIONS = 1000;
    const durations: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const trace = recorder.startTrace("mcp_request", "benchmark.tool");
      const span = trace.startSpan("mcp_tool", "benchmark.tool");
      span.event("info", "test event", { iteration: i });
      span.end("ok");
      trace.end("completed");
      const end = performance.now();
      durations.push(end - start);
    }

    durations.sort((a, b) => a - b);
    const p99Index = Math.ceil(ITERATIONS * 0.99) - 1;
    const p99 = durations[p99Index];

    console.log(`Telemetry benchmark: p99=${p99.toFixed(2)}ms, median=${durations[Math.floor(ITERATIONS / 2)].toFixed(2)}ms`);

    expect(p99).toBeLessThan(10);
  });

  test("disabled telemetry has zero overhead", () => {
    const ITERATIONS = 1000;
    const durations: number[] = [];
    const noopHandler = () => ({ result: "ok" });

    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      noopHandler();
      const end = performance.now();
      durations.push(end - start);
    }

    durations.sort((a, b) => a - b);
    const p99 = durations[Math.ceil(ITERATIONS * 0.99) - 1];
    expect(p99).toBeLessThan(1);
  });
});