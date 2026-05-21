import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { getTelemetryStats } from "../src/core/telemetry/stats";

describe("TelemetryStats", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-stats-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("returns empty stats when no data", () => {
    const stats = getTelemetryStats(store, 24);
    expect(stats.traceCount).toBe(0);
    expect(stats.errorRate).toBe(0);
    expect(stats.p95LatencyMs).toBe(0);
  });

  test("computes error rate", () => {
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 100, status: "completed",
    });
    store.insertTrace({
      id: "t2", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 50, status: "error",
    });
    const stats = getTelemetryStats(store, 24);
    expect(stats.traceCount).toBe(2);
    expect(stats.errorRate).toBe(0.5);
  });

  test("computes p95 latency", () => {
    for (let i = 0; i < 20; i++) {
      store.insertTrace({
        id: `t${i}`, trigger: "mcp_request", tool_name: "test",
        started_at: new Date().toISOString(), duration_ms: i * 10, status: "completed",
      });
    }
    const stats = getTelemetryStats(store, 24);
    expect(stats.traceCount).toBe(20);
    expect(stats.p95LatencyMs).toBeGreaterThan(0);
  });

  test("computes top operations", () => {
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    store.insertSpan({
      id: "s1", trace_id: "t1", parent_span_id: null, operation: "mcp_tool",
      name: "profile.read", started_at: new Date().toISOString(),
      duration_ms: 10, status: "ok", attributes: {},
    });
    store.insertSpan({
      id: "s2", trace_id: "t1", parent_span_id: null, operation: "mcp_tool",
      name: "observe.submit", started_at: new Date().toISOString(),
      duration_ms: 10, status: "ok", attributes: {},
    });
    const stats = getTelemetryStats(store, 24);
    expect(stats.topOperations.length).toBeGreaterThan(0);
    expect(stats.topOperations[0].operation).toBe("mcp_tool");
  });

  test("computes state drift summary", () => {
    store.insertTrace({
      id: "t1", trigger: "internal", tool_name: null,
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    store.insertSpan({
      id: "s1", trace_id: "t1", parent_span_id: null, operation: "derivation",
      name: "derive", started_at: new Date().toISOString(),
      duration_ms: 10, status: "ok", attributes: {},
    });
    store.insertStateChange({
      span_id: "s1", trace_id: "t1", entity_type: "trait", entity_id: "early_riser",
      field: "value", old_value: "0.3", new_value: "0.7", reason: "LLM",
    });
    const stats = getTelemetryStats(store, 24);
    expect(stats.topMutatedEntities.length).toBeGreaterThan(0);
    expect(stats.topMutatedEntities[0].entity_type).toBe("trait");
  });

  test("invalid lastHours: 0 falls back to 24", () => {
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const stats = getTelemetryStats(store, 0);
    // With fallback to 24h, the recent trace should be found
    expect(stats.traceCount).toBe(1);
  });

  test("invalid lastHours: -1 falls back to 24", () => {
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const stats = getTelemetryStats(store, -1);
    expect(stats.traceCount).toBe(1);
  });

  test("invalid lastHours: NaN falls back to 24", () => {
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const stats = getTelemetryStats(store, NaN);
    expect(stats.traceCount).toBe(1);
  });
});
