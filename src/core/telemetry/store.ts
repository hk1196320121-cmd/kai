import type { Database } from "bun:sqlite";
import type { KaiDB } from "../../db/client";
import type {
  Span,
  StateChange,
  TelemetryError,
  TelemetryEvent,
  Trace,
} from "./types";

interface BatchItem {
  type: "span" | "event" | "state_change" | "error";
  data: Record<string, unknown>;
}

const ALLOWED_TABLES = new Set([
  "telemetry_traces_v1",
  "telemetry_spans_v1",
  "telemetry_events_v1",
  "telemetry_state_changes_v1",
  "telemetry_errors_v1",
  "runtime_traces",
  "runtime_spans",
  "runtime_events",
  "runtime_state_changes",
  "runtime_errors",
]);

export class TelemetryStore {
  private db: Database;

  constructor(kaiDb: KaiDB) {
    this.db = kaiDb.getDatabase();
  }

  insertTrace(trace: Omit<Trace, never>): void {
    this.db
      .prepare(
        `INSERT INTO runtime_traces (id, trigger, tool_name, root_cause, started_at, duration_ms, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        trace.id,
        trace.trigger,
        trace.tool_name ?? null,
        trace.root_cause ?? null,
        trace.started_at,
        trace.duration_ms ?? null,
        trace.status,
      );
  }

  updateTrace(id: string, durationMs: number, status: string): void {
    this.db
      .prepare(
        `UPDATE runtime_traces SET duration_ms = ?, status = ? WHERE id = ?`,
      )
      .run(durationMs, status, id);
  }

  getTrace(id: string): Trace | undefined {
    const row = this.db
      .prepare("SELECT * FROM runtime_traces WHERE id = ?")
      .get(id) as Trace | null;
    return row ?? undefined;
  }

  insertSpan(span: Omit<Span, never>): void {
    this.db
      .prepare(
        `INSERT INTO runtime_spans (id, trace_id, parent_span_id, operation, name, started_at, duration_ms, status, attributes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        span.id,
        span.trace_id,
        span.parent_span_id ?? null,
        span.operation,
        span.name,
        span.started_at,
        span.duration_ms ?? null,
        span.status,
        JSON.stringify(span.attributes ?? {}),
      );
  }

  updateSpan(id: string, durationMs: number, status: string): void {
    this.db
      .prepare(
        `UPDATE runtime_spans SET duration_ms = ?, status = ? WHERE id = ?`,
      )
      .run(durationMs, status, id);
  }

  getSpansByTrace(traceId: string): Span[] {
    return this.db
      .prepare("SELECT * FROM runtime_spans WHERE trace_id = ?")
      .all(traceId) as Span[];
  }

  insertEvent(event: Omit<TelemetryEvent, "id" | "created_at">): void {
    this.db
      .prepare(
        `INSERT INTO runtime_events (span_id, trace_id, type, name, payload)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.span_id,
        event.trace_id,
        event.type,
        event.name,
        JSON.stringify(event.payload ?? {}),
      );
  }

  getEventsBySpan(spanId: string): TelemetryEvent[] {
    return this.db
      .prepare("SELECT * FROM runtime_events WHERE span_id = ?")
      .all(spanId) as TelemetryEvent[];
  }

  getEventsByTrace(traceId: string): TelemetryEvent[] {
    return this.db
      .prepare("SELECT * FROM runtime_events WHERE trace_id = ?")
      .all(traceId) as TelemetryEvent[];
  }

  insertStateChange(change: Omit<StateChange, "id" | "created_at">): void {
    this.db
      .prepare(
        `INSERT INTO runtime_state_changes (span_id, trace_id, entity_type, entity_id, field, old_value, new_value, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        change.span_id,
        change.trace_id,
        change.entity_type,
        change.entity_id,
        change.field,
        change.old_value ?? null,
        change.new_value ?? null,
        change.reason ?? null,
      );
  }

  getStateChangesByTrace(traceId: string): StateChange[] {
    return this.db
      .prepare("SELECT * FROM runtime_state_changes WHERE trace_id = ?")
      .all(traceId) as StateChange[];
  }

  insertError(error: Omit<TelemetryError, "id" | "created_at">): void {
    this.db
      .prepare(
        `INSERT INTO runtime_errors (span_id, trace_id, error_type, message, stack_trace, recoverable, context)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        error.span_id,
        error.trace_id,
        error.error_type,
        error.message,
        error.stack_trace ?? null,
        error.recoverable,
        JSON.stringify(error.context ?? {}),
      );
  }

  getErrorsByTrace(traceId: string): TelemetryError[] {
    return this.db
      .prepare("SELECT * FROM runtime_errors WHERE trace_id = ?")
      .all(traceId) as TelemetryError[];
  }

  getRecentErrors(lastN: number): TelemetryError[] {
    return this.db
      .prepare("SELECT * FROM runtime_errors ORDER BY created_at DESC LIMIT ?")
      .all(lastN) as TelemetryError[];
  }

  getSimilarErrors(
    errorType: string,
    limit: number,
  ): Array<{
    error_type: string;
    message: string;
    count: number;
    last_seen: string;
  }> {
    return this.db
      .prepare(
        `SELECT error_type, message, COUNT(*) as count, MAX(created_at) as last_seen
         FROM runtime_errors
         WHERE error_type = ? AND created_at >= datetime('now', '-30 days')
         GROUP BY error_type, message
         ORDER BY count DESC
         LIMIT ?`,
      )
      .all(errorType, limit) as Array<{
      error_type: string;
      message: string;
      count: number;
      last_seen: string;
    }>;
  }

  queryTelemetry(sql: string): Record<string, unknown>[] {
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();

    if (!upper.startsWith("SELECT")) {
      throw new Error("Query must start with SELECT");
    }

    // Reject semicolons to prevent multi-statement injection
    if (trimmed.includes(";")) {
      throw new Error("Semicolons are not allowed in queries");
    }

    // Allowlist: only telemetry tables/views may be referenced
    const tableRefs = upper.match(/\b(FROM|JOIN)\s+(\w+)/g) ?? [];
    for (const ref of tableRefs) {
      const tableName = ref.replace(/^(FROM|JOIN)\s+/i, "").trim();
      if (!ALLOWED_TABLES.has(tableName.toLowerCase())) {
        throw new Error(
          `Table '${tableName}' is not a telemetry table. Allowed: telemetry_*_v1, runtime_*`,
        );
      }
    }

    // Block subqueries that could reference non-telemetry tables
    if (upper.includes("UNION")) {
      throw new Error("UNION is not allowed in telemetry queries");
    }

    this.db.exec("BEGIN");
    try {
      const rows = this.db.prepare(trimmed).all() as Record<
        string,
        unknown
      >[];
      return rows;
    } finally {
      this.db.exec("ROLLBACK");
    }
  }

  flushBatch(items: BatchItem[]): void {
    // Temporarily disable FK checks to allow inserting child spans
    // before their parent spans exist (deferred parent flush).
    this.db.exec("PRAGMA foreign_keys = OFF");
    try {
      const tx = this.db.transaction(() => {
        for (const item of items) {
          switch (item.type) {
            case "span":
              this.insertSpan(item.data as Omit<Span, never>);
              break;
            case "event":
              this.insertEvent(
                item.data as Omit<TelemetryEvent, "id" | "created_at">,
              );
              break;
            case "state_change":
              this.insertStateChange(
                item.data as Omit<StateChange, "id" | "created_at">,
              );
              break;
            case "error":
              this.insertError(
                item.data as Omit<TelemetryError, "id" | "created_at">,
              );
              break;
          }
        }
      });
      tx();
    } finally {
      this.db.exec("PRAGMA foreign_keys = ON");
    }
  }

  pruneTelemetry(maxAgeDays: number): void {
    const cutoff = `datetime('now', '-${maxAgeDays} days')`;
    const traceIds = this.db
      .prepare(
        `SELECT id FROM runtime_traces WHERE started_at < ${cutoff} LIMIT 1000`,
      )
      .all() as { id: string }[];
    if (traceIds.length === 0) return;

    const ids = traceIds.map((t) => t.id);
    const placeholders = ids.map(() => "?").join(",");
    const pruneTx = this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM runtime_errors WHERE trace_id IN (${placeholders})`)
        .run(...ids);
      this.db
        .prepare(
          `DELETE FROM runtime_state_changes WHERE trace_id IN (${placeholders})`,
        )
        .run(...ids);
      this.db
        .prepare(`DELETE FROM runtime_events WHERE trace_id IN (${placeholders})`)
        .run(...ids);
      this.db
        .prepare(`DELETE FROM runtime_spans WHERE trace_id IN (${placeholders})`)
        .run(...ids);
      this.db
        .prepare(`DELETE FROM runtime_traces WHERE id IN (${placeholders})`)
        .run(...ids);
    });
    pruneTx();
  }
}
