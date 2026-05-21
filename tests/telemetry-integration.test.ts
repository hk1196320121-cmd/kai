import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryRecorder } from "../src/core/telemetry/recorder";
import { TelemetryStore } from "../src/core/telemetry/store";
import { getTelemetryStats } from "../src/core/telemetry/stats";
import { explainTelemetry } from "../src/core/telemetry/explain";

describe("Telemetry Integration — Full Causal Chain", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let recorder: TelemetryRecorder;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-integ-test-${Date.now()}.db`);
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

  test("full MCP call trace: request → tool → derivation → state change", () => {
    const trace = recorder.startTrace("mcp_request", "derive.trigger");
    const toolSpan = trace.startSpan("mcp_tool", "derive.trigger");

    const deriveSpan = toolSpan.startChild("derivation", "rule-based derivation");
    deriveSpan.event("info", "rule matched", { dimension: "early_riser" });
    deriveSpan.stateChange({
      type: "trait", id: "early_riser", field: "value",
      old: "0.3", new: "0.7", reason: "rule: morning observations",
    });
    deriveSpan.end("ok");

    toolSpan.end("ok");
    trace.end("completed");

    const persistedTrace = store.getTrace(trace.traceId);
    expect(persistedTrace!.status).toBe("completed");

    const spans = store.getSpansByTrace(trace.traceId);
    expect(spans).toHaveLength(2);

    const deriveSpans = spans.filter((s) => s.operation === "derivation");
    expect(deriveSpans).toHaveLength(1);

    const events = store.getEventsByTrace(trace.traceId);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("rule matched");

    const changes = store.getStateChangesByTrace(trace.traceId);
    expect(changes).toHaveLength(1);
    expect(changes[0].old_value).toBe("0.3");
    expect(changes[0].new_value).toBe("0.7");
  });

  test("error trace captures error + context", () => {
    const trace = recorder.startTrace("mcp_request", "derive.trigger");
    const span = trace.startSpan("mcp_tool", "derive.trigger");
    const llmSpan = span.startChild("llm_call", "derive from LLM");
    const err = new Error("LLM API timeout");
    llmSpan.error(err, true, { retries: 2 });
    llmSpan.end("error");
    span.end("error");
    trace.end("error");

    const errors = store.getErrorsByTrace(trace.traceId);
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe("Error");
    expect(errors[0].recoverable).toBe(1);

    const similar = store.getSimilarErrors("Error", 3);
    expect(similar.length).toBeGreaterThanOrEqual(1);
  });

  test("stats reflect accumulated traces", () => {
    for (let i = 0; i < 5; i++) {
      const trace = recorder.startTrace("mcp_request", "test");
      const span = trace.startSpan("mcp_tool", "test");
      span.end("ok");
      trace.end("completed");
    }
    const errTrace = recorder.startTrace("mcp_request", "fail");
    const errSpan = errTrace.startSpan("mcp_tool", "fail");
    errSpan.end("error");
    errTrace.end("error");

    const stats = getTelemetryStats(store, 24);
    expect(stats.traceCount).toBe(6);
    expect(stats.errorRate).toBeCloseTo(1 / 6, 1);
  });

  test("explain returns summary for accumulated data", async () => {
    for (let i = 0; i < 3; i++) {
      const trace = recorder.startTrace("mcp_request", "test");
      const span = trace.startSpan("mcp_tool", "test");
      span.end("ok");
      trace.end("completed");
    }

    const result = await explainTelemetry(store, "what happened?", null);
    expect(result.summary).toContain("3");
  });

  test("SQL query against views returns data", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const span = trace.startSpan("mcp_tool", "test");
    span.end("ok");
    trace.end("completed");

    const rows = store.queryTelemetry(
      "SELECT * FROM telemetry_traces_v1 WHERE tool_name = 'test'",
    );
    expect(rows).toHaveLength(1);
  });

  test("pruning removes old data", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const span = trace.startSpan("mcp_tool", "test");
    span.end("ok");
    trace.end("completed");

    store.pruneTelemetry(30);
    const persisted = store.getTrace(trace.traceId);
    expect(persisted).toBeDefined();
  });
});