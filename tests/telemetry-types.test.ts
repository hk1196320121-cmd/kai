import { describe, expect, test } from "bun:test";
import type {
  Trace,
  Span,
  TelemetryEvent,
  StateChange,
  TelemetryError,
  TraceStatus,
  SpanStatus,
  TriggerType,
  OperationType,
  EntityType,
  ExplainResult,
  ExplainInsight,
} from "../src/core/telemetry/types";

describe("Telemetry Types", () => {
  test("Trace has all required fields", () => {
    const trace: Trace = {
      id: "trace-1",
      trigger: "mcp_request",
      tool_name: "profile.read",
      root_cause: "user request",
      started_at: new Date().toISOString(),
      duration_ms: null,
      status: "running",
    };
    expect(trace.id).toBe("trace-1");
    expect(trace.status).toBe("running");
    expect(trace.tool_name).toBe("profile.read");
    expect(trace.duration_ms).toBeNull();
  });

  test("Span has trace reference and optional parent", () => {
    const span: Span = {
      id: "span-1",
      trace_id: "trace-1",
      parent_span_id: null,
      operation: "mcp_tool",
      name: "profile.read",
      started_at: new Date().toISOString(),
      duration_ms: null,
      status: "running",
      attributes: {},
    };
    expect(span.trace_id).toBe("trace-1");
    expect(span.parent_span_id).toBeNull();
    expect(span.attributes).toEqual({});
  });

  test("Span with parent creates nested structure", () => {
    const span: Span = {
      id: "span-2",
      trace_id: "trace-1",
      parent_span_id: "span-1",
      operation: "llm_call",
      name: "derive traits",
      started_at: new Date().toISOString(),
      duration_ms: null,
      status: "running",
      attributes: { model: "gpt-4o-mini" },
    };
    expect(span.parent_span_id).toBe("span-1");
  });

  test("TelemetryEvent has span and trace references", () => {
    const event: TelemetryEvent = {
      id: 1,
      span_id: "span-1",
      trace_id: "trace-1",
      type: "info",
      name: "rule matched",
      payload: { rule: "early_riser" },
      created_at: new Date().toISOString(),
    };
    expect(event.type).toBe("info");
    expect(event.payload).toEqual({ rule: "early_riser" });
  });

  test("StateChange captures before/after", () => {
    const change: StateChange = {
      id: 1,
      span_id: "span-1",
      trace_id: "trace-1",
      entity_type: "trait",
      entity_id: "early_riser",
      field: "value",
      old_value: "0.3",
      new_value: "0.7",
      reason: "LLM derivation",
      created_at: new Date().toISOString(),
    };
    expect(change.old_value).toBe("0.3");
    expect(change.new_value).toBe("0.7");
  });

  test("TelemetryError captures recoverable flag", () => {
    const err: TelemetryError = {
      id: 1,
      span_id: "span-1",
      trace_id: "trace-1",
      error_type: "TimeoutError",
      message: "LLM call timed out",
      stack_trace: "at LLMProvider.call(...)",
      recoverable: 1,
      context: { retries: 2 },
      created_at: new Date().toISOString(),
    };
    expect(err.recoverable).toBe(1);
  });

  test("ExplainResult has summary, traces, and insights", () => {
    const result: ExplainResult = {
      summary: "All systems healthy",
      traces: ["trace-1", "trace-2"],
      insights: [
        { claim: "Error rate is low", evidence: "2 errors / 100 traces" },
      ],
    };
    expect(result.insights).toHaveLength(1);
  });

  test("TraceStatus narrows to valid values", () => {
    const statuses: TraceStatus[] = ["running", "completed", "error"];
    expect(statuses).toHaveLength(3);
  });

  test("OperationType covers all instrumented operations", () => {
    const ops: OperationType[] = [
      "mcp_tool", "derivation", "task_exec",
      "genome_compile", "genome_evolve", "llm_call", "db_write",
    ];
    expect(ops).toHaveLength(7);
  });
});
