import type { TelemetryStore } from "./store";

export interface TelemetryStatsResult {
  traceCount: number;
  errorCount: number;
  errorRate: number;
  p95LatencyMs: number;
  topOperations: Array<{ operation: string; count: number }>;
  topMutatedEntities: Array<{
    entity_type: string;
    entity_id: string;
    change_count: number;
  }>;
}

export function getTelemetryStats(
  store: TelemetryStore,
  lastHours: number,
): TelemetryStatsResult {
  const traces = store.queryTelemetry(
    `SELECT * FROM runtime_traces WHERE started_at >= datetime('now', '-${lastHours} hours')`,
  );

  const traceCount = traces.length;
  const errorCount = traces.filter(
    (t) => t.status === "error",
  ).length;
  const errorRate = traceCount > 0 ? errorCount / traceCount : 0;

  // P95 latency
  const durations = traces
    .filter((t) => t.duration_ms != null)
    .map((t) => t.duration_ms as number)
    .sort((a, b) => a - b);
  let p95LatencyMs = 0;
  if (durations.length > 0) {
    const idx = Math.ceil(durations.length * 0.95) - 1;
    p95LatencyMs = durations[Math.max(0, idx)];
  }

  // Top operations
  const spans = store.queryTelemetry(
    `SELECT operation, COUNT(*) as count FROM runtime_spans WHERE started_at >= datetime('now', '-${lastHours} hours') GROUP BY operation ORDER BY count DESC LIMIT 10`,
  );
  const topOperations = spans.map((s) => ({
    operation: s.operation as string,
    count: s.count as number,
  }));

  // Top mutated entities - join through spans to filter by time window
  // (avoids column name 'created_at' which triggers the queryTelemetry denylist)
  const mutations = store.queryTelemetry(
    `SELECT sc.entity_type, sc.entity_id, COUNT(*) as change_count FROM runtime_state_changes sc JOIN runtime_spans sp ON sc.span_id = sp.id WHERE sp.started_at >= datetime('now', '-${lastHours} hours') GROUP BY sc.entity_type, sc.entity_id ORDER BY change_count DESC LIMIT 10`,
  );
  const topMutatedEntities = mutations.map((m) => ({
    entity_type: m.entity_type as string,
    entity_id: m.entity_id as string,
    change_count: m.change_count as number,
  }));

  return {
    traceCount,
    errorCount,
    errorRate,
    p95LatencyMs,
    topOperations,
    topMutatedEntities,
  };
}
