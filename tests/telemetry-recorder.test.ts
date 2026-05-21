import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { TelemetryRecorder } from "../src/core/telemetry/recorder";

describe("TelemetryRecorder", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let recorder: TelemetryRecorder;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-rec-test-${Date.now()}.db`);
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

  test("startTrace creates a running trace", () => {
    const trace = recorder.startTrace("mcp_request", "profile.read");
    expect(trace.traceId).toBeDefined();
    const persisted = store.getTrace(trace.traceId);
    expect(persisted).toBeDefined();
    expect(persisted!.status).toBe("running");
  });

  test("trace.end sets completed status and duration", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    trace.end("completed");
    const persisted = store.getTrace(trace.traceId);
    expect(persisted!.status).toBe("completed");
    expect(persisted!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("trace.startSpan creates nested span", () => {
    const trace = recorder.startTrace("mcp_request", "observe.submit");
    const span = trace.startSpan("mcp_tool", "observe.submit");
    expect(span.spanId).toBeDefined();
    expect(span.traceId).toBe(trace.traceId);
  });

  test("span.end flushes span data", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const span = trace.startSpan("mcp_tool", "test");
    span.end("ok");
    trace.end("completed");
    const spans = store.getSpansByTrace(trace.traceId);
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("ok");
  });

  test("span.event records event", () => {
    const trace = recorder.startTrace("internal", undefined);
    const span = trace.startSpan("derivation", "derive");
    span.event("info", "rule matched", { rule: "early_riser" });
    span.end("ok");
    trace.end("completed");
    const events = store.getEventsBySpan(span.spanId);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("rule matched");
  });

  test("span.stateChange records state change", () => {
    const trace = recorder.startTrace("internal", undefined);
    const span = trace.startSpan("derivation", "derive");
    span.stateChange({
      type: "trait", id: "early_riser", field: "value",
      old: "0.3", new: "0.7", reason: "LLM",
    });
    span.end("ok");
    trace.end("completed");
    const changes = store.getStateChangesByTrace(trace.traceId);
    expect(changes).toHaveLength(1);
    expect(changes[0].new_value).toBe("0.7");
  });

  test("span.error records error", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const span = trace.startSpan("mcp_tool", "test");
    span.error(new Error("test error"), true, { step: 1 });
    span.end("error");
    trace.end("error");
    const errors = store.getErrorsByTrace(trace.traceId);
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe("Error");
    expect(errors[0].recoverable).toBe(1);
  });

  test("span.startChild creates nested span", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const parent = trace.startSpan("mcp_tool", "parent");
    const child = parent.startChild("db_write", "insert");
    child.end("ok");
    parent.end("ok");
    trace.end("completed");
    const spans = store.getSpansByTrace(trace.traceId);
    expect(spans).toHaveLength(2);
    const childSpan = spans.find((s) => s.name === "insert");
    expect(childSpan!.parent_span_id).toBe(parent.spanId);
  });

  test("telemetry failure does not propagate", () => {
    const failStore = {
      insertTrace: () => { throw new Error("DB error"); },
    } as unknown as TelemetryStore;
    const safeRecorder = new TelemetryRecorder(failStore);
    const trace = safeRecorder.startTrace("mcp_request", "test");
    expect(trace.traceId).toBeDefined();
  });

  test("sanitizes attributes on span", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const span = trace.startSpan("mcp_tool", "test");
    span.event("info", "test", { api_key: "secret123", normal: "ok" });
    span.end("ok");
    trace.end("completed");
    const events = store.getEventsBySpan(span.spanId);
    const payload = JSON.parse(events[0].payload as unknown as string);
    expect(payload.api_key).toBe("[REDACTED]");
    expect(payload.normal).toBe("ok");
  });
});
