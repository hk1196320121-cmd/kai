import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";

describe("TelemetryStore", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-tel-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("insertTrace and getTrace", () => {
    store.insertTrace({
      id: "t1",
      trigger: "mcp_request",
      tool_name: "profile.read",
      root_cause: "user call",
      started_at: "2026-01-01T00:00:00Z",
      duration_ms: null,
      status: "running",
    });
    const trace = store.getTrace("t1");
    expect(trace).toBeDefined();
    expect(trace!.id).toBe("t1");
    expect(trace!.trigger).toBe("mcp_request");
  });

  test("updateTrace sets duration and status", () => {
    store.insertTrace({
      id: "t2",
      trigger: "internal",
      tool_name: null,
      started_at: "2026-01-01T00:00:00Z",
      duration_ms: null,
      status: "running",
    });
    store.updateTrace("t2", 150, "completed");
    const trace = store.getTrace("t2");
    expect(trace!.duration_ms).toBe(150);
    expect(trace!.status).toBe("completed");
  });

  test("insertSpan and getSpansByTrace", () => {
    store.insertTrace({
      id: "t3", trigger: "mcp_request", tool_name: "observe.submit",
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "running",
    });
    store.insertSpan({
      id: "s1",
      trace_id: "t3",
      parent_span_id: null,
      operation: "mcp_tool",
      name: "observe.submit",
      started_at: "2026-01-01T00:00:00Z",
      duration_ms: null,
      status: "running",
      attributes: { input_size: 1024 },
    });
    const spans = store.getSpansByTrace("t3");
    expect(spans).toHaveLength(1);
    expect(spans[0].operation).toBe("mcp_tool");
  });

  test("updateSpan sets duration and status", () => {
    store.insertTrace({
      id: "t4", trigger: "mcp_request", tool_name: "test",
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "running",
    });
    store.insertSpan({
      id: "s2", trace_id: "t4", parent_span_id: null, operation: "mcp_tool",
      name: "test", started_at: "2026-01-01T00:00:00Z", duration_ms: null,
      status: "running", attributes: {},
    });
    store.updateSpan("s2", 50, "ok");
    const spans = store.getSpansByTrace("t4");
    expect(spans[0].duration_ms).toBe(50);
    expect(spans[0].status).toBe("ok");
  });

  test("insertEvent and getEventsBySpan", () => {
    store.insertTrace({
      id: "t5", trigger: "internal", tool_name: null,
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "running",
    });
    store.insertSpan({
      id: "s3", trace_id: "t5", parent_span_id: null, operation: "derivation",
      name: "derive", started_at: "2026-01-01T00:00:00Z", duration_ms: null,
      status: "running", attributes: {},
    });
    store.insertEvent({
      span_id: "s3", trace_id: "t5", type: "info", name: "rule matched",
      payload: { dimension: "early_riser" },
    });
    const events = store.getEventsBySpan("s3");
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("rule matched");
  });

  test("insertStateChange and getStateChangesByTrace", () => {
    store.insertTrace({
      id: "t6", trigger: "internal", tool_name: null,
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "running",
    });
    store.insertSpan({
      id: "s4", trace_id: "t6", parent_span_id: null, operation: "derivation",
      name: "derive", started_at: "2026-01-01T00:00:00Z", duration_ms: null,
      status: "running", attributes: {},
    });
    store.insertStateChange({
      span_id: "s4", trace_id: "t6", entity_type: "trait", entity_id: "early_riser",
      field: "value", old_value: "0.3", new_value: "0.7", reason: "LLM derivation",
    });
    const changes = store.getStateChangesByTrace("t6");
    expect(changes).toHaveLength(1);
    expect(changes[0].old_value).toBe("0.3");
    expect(changes[0].new_value).toBe("0.7");
  });

  test("insertError and getErrorsByTrace", () => {
    store.insertTrace({
      id: "t7", trigger: "mcp_request", tool_name: "derive.trigger",
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "error",
    });
    store.insertSpan({
      id: "s5", trace_id: "t7", parent_span_id: null, operation: "llm_call",
      name: "llm derive", started_at: "2026-01-01T00:00:00Z", duration_ms: null,
      status: "error", attributes: {},
    });
    store.insertError({
      span_id: "s5", trace_id: "t7", error_type: "TimeoutError",
      message: "LLM call timed out", stack_trace: "at LLMProvider.call",
      recoverable: 1, context: { retries: 2 },
    });
    const errors = store.getErrorsByTrace("t7");
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe("TimeoutError");
  });

  test("queryTelemetry executes SELECT against views", () => {
    store.insertTrace({
      id: "t8", trigger: "mcp_request", tool_name: "profile.read",
      started_at: "2026-01-01T00:00:00Z", duration_ms: 100, status: "completed",
    });
    const rows = store.queryTelemetry(
      "SELECT * FROM telemetry_traces_v1 WHERE id = 't8'",
    );
    expect(rows).toHaveLength(1);
  });

  test("queryTelemetry rejects non-SELECT queries", () => {
    expect(() => store.queryTelemetry("DROP TABLE runtime_traces")).toThrow(
      /must start with SELECT/i,
    );
    expect(() => store.queryTelemetry("DELETE FROM runtime_traces")).toThrow(
      /must start with SELECT/i,
    );
  });

  test("queryTelemetry rejects queries targeting non-telemetry tables", () => {
    expect(() => store.queryTelemetry("SELECT * FROM observations")).toThrow(
      /not a telemetry table/i,
    );
    expect(() => store.queryTelemetry("SELECT * FROM traits")).toThrow(
      /not a telemetry table/i,
    );
  });

  test("queryTelemetry rejects UNION-based injection", () => {
    expect(() =>
      store.queryTelemetry(
        "SELECT * FROM runtime_traces UNION SELECT * FROM runtime_traces",
      ),
    ).toThrow(/UNION is not allowed/i);
  });

  test("queryTelemetry rejects semicolons", () => {
    expect(() =>
      store.queryTelemetry("SELECT * FROM runtime_traces; DROP TABLE x"),
    ).toThrow(/Semicolons/i);
  });

  test("flushBatch writes multiple spans in one transaction", () => {
    store.insertTrace({
      id: "t9", trigger: "mcp_request", tool_name: "test",
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "running",
    });
    store.flushBatch([
      { type: "span", data: {
        id: "s6", trace_id: "t9", parent_span_id: null, operation: "mcp_tool",
        name: "test", started_at: "2026-01-01T00:00:00Z", duration_ms: 10,
        status: "ok", attributes: {},
      }},
      { type: "span", data: {
        id: "s7", trace_id: "t9", parent_span_id: "s6", operation: "db_write",
        name: "insert", started_at: "2026-01-01T00:00:00Z", duration_ms: 5,
        status: "ok", attributes: {},
      }},
    ]);
    const spans = store.getSpansByTrace("t9");
    expect(spans).toHaveLength(2);
  });

  test("getRecentErrors returns errors within time window", () => {
    store.insertTrace({
      id: "t10", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "error",
    });
    store.insertSpan({
      id: "s8", trace_id: "t10", parent_span_id: null, operation: "mcp_tool",
      name: "test", started_at: new Date().toISOString(), duration_ms: 10,
      status: "error", attributes: {},
    });
    store.insertError({
      span_id: "s8", trace_id: "t10", error_type: "TestError",
      message: "test error", stack_trace: null, recoverable: 0, context: {},
    });
    const errors = store.getRecentErrors(1);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  test("getSimilarErrors returns historical errors by type", () => {
    store.insertTrace({
      id: "t11", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "error",
    });
    store.insertSpan({
      id: "s9", trace_id: "t11", parent_span_id: null, operation: "mcp_tool",
      name: "test", started_at: new Date().toISOString(), duration_ms: 10,
      status: "error", attributes: {},
    });
    store.insertError({
      span_id: "s9", trace_id: "t11", error_type: "TimeoutError",
      message: "timed out", stack_trace: null, recoverable: 1, context: {},
    });
    const similar = store.getSimilarErrors("TimeoutError", 3);
    expect(similar.length).toBeGreaterThanOrEqual(1);
    expect(similar[0].error_type).toBe("TimeoutError");
  });

  test("pruneTelemetry removes old records", () => {
    store.insertTrace({
      id: "t12", trigger: "mcp_request", tool_name: "test",
      started_at: "2020-01-01T00:00:00Z", duration_ms: 10, status: "completed",
    });
    store.pruneTelemetry(30);
    const trace = store.getTrace("t12");
    expect(trace).toBeUndefined();
  });
});
