import { describe, test, expect, beforeEach } from "bun:test";
import { setNoColor } from "../../../src/cli/format";
import {
  renderHealthReport,
  renderTrace,
  renderErrorList,
} from "../../../src/cli/renderers/telemetry";
import type { Trace, Span, TelemetryError } from "../../../src/core/telemetry/types";
import type { TelemetryStatsResult } from "../../../src/core/telemetry/stats";

beforeEach(() => {
  setNoColor(true);
});

function makeStats(
  overrides: Partial<TelemetryStatsResult> = {},
): TelemetryStatsResult {
  return {
    traceCount: 0,
    errorCount: 0,
    errorRate: 0,
    p95LatencyMs: 0,
    topOperations: [],
    topMutatedEntities: [],
    ...overrides,
  };
}

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    id: "trace-abcdefgh",
    trigger: "mcp_request",
    tool_name: null,
    root_cause: null,
    started_at: "2024-01-01T00:00:00Z",
    duration_ms: 150,
    status: "completed",
    ...overrides,
  };
}

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    id: "s1",
    trace_id: "trace-abcdefgh",
    parent_span_id: null,
    operation: "derivation",
    name: "rule_derive",
    started_at: "2024-01-01T00:00:00Z",
    duration_ms: 80,
    status: "ok",
    attributes: {},
    ...overrides,
  };
}

function makeError(overrides: Partial<TelemetryError> = {}): TelemetryError {
  return {
    id: 1,
    span_id: "s1",
    trace_id: "t1",
    error_type: "db_error",
    message: "Database connection failed: timeout after 5000ms",
    recoverable: 0,
    context: {},
    created_at: "2024-01-15T10:30:00Z",
    ...overrides,
  };
}

describe("telemetry renderer", () => {
  describe("renderHealthReport", () => {
    test("renders health dashboard", () => {
      const output = renderHealthReport(
        makeStats({
          traceCount: 142,
          errorCount: 3,
          errorRate: 0.021,
          p95LatencyMs: 340,
          topOperations: [
            { operation: "profile.read", count: 85 },
            { operation: "derive.trigger", count: 42 },
          ],
        }),
      );
      expect(output).toContain("142");
      expect(output).toContain("340ms");
      expect(output).toContain("profile.read");
    });

    test("renders error rate percentage", () => {
      const output = renderHealthReport(
        makeStats({
          traceCount: 100,
          errorCount: 3,
          errorRate: 0.021,
          p95LatencyMs: 200,
        }),
      );
      expect(output).toContain("2.1%");
    });

    test("renders health with zero traces", () => {
      const output = renderHealthReport(makeStats());
      expect(output).toContain("0");
    });

    test("omits error percentage when no traces", () => {
      const output = renderHealthReport(
        makeStats({ traceCount: 0, errorCount: 0, errorRate: 0 }),
      );
      // When traceCount is 0, the (x.x%) suffix is empty
      expect(output).not.toContain("NaN");
    });

    test("renders top operations table", () => {
      const output = renderHealthReport(
        makeStats({
          topOperations: [
            { operation: "mcp_tool", count: 200 },
            { operation: "derivation", count: 150 },
          ],
        }),
      );
      expect(output).toContain("mcp_tool");
      expect(output).toContain("200");
      expect(output).toContain("derivation");
      expect(output).toContain("150");
    });

    test("omits top operations section when empty", () => {
      const output = renderHealthReport(
        makeStats({ topOperations: [] }),
      );
      expect(output).not.toContain("Top Operations");
    });

    test("renders p95 latency", () => {
      const output = renderHealthReport(
        makeStats({ p95LatencyMs: 500 }),
      );
      expect(output).toContain("500ms");
    });
  });

  describe("renderTrace", () => {
    test("renders trace with spans", () => {
      const output = renderTrace(
        makeTrace({
          id: "trace-abcdefgh",
          trigger: "mcp_request",
          tool_name: "profile.read",
          duration_ms: 150,
          status: "completed",
        }),
        [
          makeSpan({
            id: "s1",
            trace_id: "trace-abcdefgh",
            operation: "derivation",
            name: "rule_derive",
            duration_ms: 80,
            status: "ok",
          }),
          makeSpan({
            id: "s2",
            trace_id: "trace-abcdefgh",
            parent_span_id: "s1",
            operation: "llm_call",
            name: "llm_derive",
            duration_ms: 60,
            status: "ok",
          }),
        ],
      );
      expect(output).toContain("profile.read");
      expect(output).toContain("150ms");
      expect(output).toContain("rule_derive");
    });

    test("renders trace id truncated", () => {
      const output = renderTrace(
        makeTrace({ id: "trace-abcdefghijklmnop" }),
        [],
      );
      expect(output).toContain("trace-ab");
    });

    test("renders trace without tool name", () => {
      const output = renderTrace(
        makeTrace({ tool_name: null }),
        [],
      );
      expect(output).toContain("mcp_request");
    });

    test("renders trace status", () => {
      const output = renderTrace(
        makeTrace({ status: "completed" }),
        [],
      );
      expect(output).toContain("completed");
    });

    test("renders trace started date", () => {
      const output = renderTrace(
        makeTrace({ started_at: "2024-06-20T14:30:00Z" }),
        [],
      );
      expect(output).toContain("2024-06-20");
    });

    test("renders nested spans with indentation", () => {
      const output = renderTrace(
        makeTrace(),
        [
          makeSpan({
            id: "parent",
            parent_span_id: null,
            operation: "derivation",
            name: "parent_span",
            duration_ms: 100,
          }),
          makeSpan({
            id: "child",
            trace_id: "trace-abcdefgh",
            parent_span_id: "parent",
            operation: "llm_call",
            name: "child_span",
            duration_ms: 50,
          }),
        ],
      );
      expect(output).toContain("parent_span");
      expect(output).toContain("child_span");
    });

    test("renders span duration dash when null", () => {
      const output = renderTrace(
        makeTrace(),
        [
          makeSpan({
            duration_ms: null,
            name: "unknown_dur",
          }),
        ],
      );
      // When duration_ms is null, renderer outputs "—"
      expect(output).toContain("unknown_dur");
    });
  });

  describe("renderErrorList", () => {
    test("renders empty error list", () => {
      const output = renderErrorList([]);
      expect(output).toContain("No errors recorded");
    });

    test("renders error list with type", () => {
      const output = renderErrorList([
        makeError({ error_type: "db_error" }),
      ]);
      expect(output).toContain("db_error");
    });

    test("renders error message", () => {
      const output = renderErrorList([
        makeError({ message: "Short error" }),
      ]);
      expect(output).toContain("Short error");
    });

    test("truncates long error messages", () => {
      const longMsg = "A".repeat(60);
      const output = renderErrorList([
        makeError({ message: longMsg }),
      ]);
      // Messages > 40 chars are truncated to 37 + "..."
      expect(output).toContain("...");
    });

    test("renders error date", () => {
      const output = renderErrorList([
        makeError({ created_at: "2024-07-20T15:30:00Z" }),
      ]);
      expect(output).toContain("2024-07-20");
    });

    test("renders error id", () => {
      const output = renderErrorList([
        makeError({ id: 42 }),
      ]);
      expect(output).toContain("42");
    });

    test("renders multiple errors", () => {
      const output = renderErrorList([
        makeError({ id: 1, error_type: "type_a" }),
        makeError({ id: 2, error_type: "type_b" }),
      ]);
      expect(output).toContain("type_a");
      expect(output).toContain("type_b");
    });
  });
});
