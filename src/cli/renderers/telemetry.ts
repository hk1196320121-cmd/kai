import type { TelemetryStatsResult } from "../../core/telemetry/stats";
import type { Span, TelemetryError, Trace } from "../../core/telemetry/types";
import { dim, header, kv, section, table } from "../format";

/**
 * Render a telemetry health summary.
 */
export function renderHealthReport(stats: TelemetryStatsResult): string {
  const lines: string[] = [];

  lines.push(header("Telemetry Health"));
  lines.push("");

  lines.push(kv("traces", stats.traceCount));

  const errorPct =
    stats.traceCount > 0 ? ` (${(stats.errorRate * 100).toFixed(1)}%)` : "";
  lines.push(kv("errors", `${stats.errorCount}${errorPct}`));

  lines.push(kv("p95 latency", `${stats.p95LatencyMs}ms`));
  lines.push("");

  if (stats.topOperations.length > 0) {
    const rows = stats.topOperations.map((op) => [
      op.operation,
      String(op.count),
    ]);
    lines.push(
      section(
        "Top Operations",
        table(["Operation", "Count"], rows).split("\n"),
      ),
    );
  }

  return lines.join("\n");
}

/**
 * Render a single trace with its spans.
 */
export function renderTrace(trace: Trace, spans: Span[]): string {
  const lines: string[] = [];

  lines.push(header(`Trace: ${trace.id.slice(0, 8)}`));
  lines.push("");

  lines.push(kv("trigger", trace.trigger));
  if (trace.tool_name) {
    lines.push(kv("tool", trace.tool_name));
  }
  lines.push(kv("status", trace.status));
  lines.push(
    kv("duration", trace.duration_ms != null ? `${trace.duration_ms}ms` : "—"),
  );
  lines.push(kv("started", trace.started_at.slice(0, 19)));
  lines.push("");

  if (spans.length > 0) {
    // Build a nested view using parent_span_id indentation
    const spanLines = renderNestedSpans(spans);
    lines.push(section("Spans", spanLines));
  }

  return lines.join("\n");
}

/**
 * Render spans with indentation based on parent_span_id nesting.
 */
function renderNestedSpans(spans: Span[]): string[] {
  const childrenOf = new Map<string, Span[]>();

  for (const span of spans) {
    const parentId = span.parent_span_id ?? "__root__";
    const children = childrenOf.get(parentId) ?? [];
    children.push(span);
    childrenOf.set(parentId, children);
  }

  const result: string[] = [];

  function renderSpan(span: Span, depth: number): void {
    const indent = "  ".repeat(depth);
    const duration = span.duration_ms != null ? `${span.duration_ms}ms` : "—";
    result.push(
      `${indent}${span.operation} (${span.name}) ${duration} ${dim(span.status)}`,
    );

    const children = childrenOf.get(span.id) ?? [];
    for (const child of children) {
      renderSpan(child, depth + 1);
    }
  }

  // Render root spans: those with no parent, AND orphans whose parent is missing
  const rootSpans = childrenOf.get("__root__") ?? [];
  for (const root of rootSpans) {
    renderSpan(root, 0);
  }
  // Orphaned spans: have a parent_span_id that isn't in the set
  const allIds = new Set(spans.map((s) => s.id));
  const rendered = new Set(rootSpans.map((s) => s.id));
  for (const span of spans) {
    if (rendered.has(span.id)) continue;
    if (span.parent_span_id && !allIds.has(span.parent_span_id)) {
      renderSpan(span, 0);
    }
  }

  return result;
}

/**
 * Render a list of telemetry errors as a table.
 */
export function renderErrorList(errors: TelemetryError[]): string {
  if (errors.length === 0) {
    return dim("No errors recorded.");
  }

  const rows = errors.map((err) => [
    String(err.id),
    err.error_type,
    err.message.length > 40 ? `${err.message.slice(0, 37)}...` : err.message,
    err.created_at.slice(0, 10),
  ]);

  return table(["ID", "Type", "Message", "Date"], rows);
}
