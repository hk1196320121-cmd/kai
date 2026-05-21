import { sanitize } from "./sanitizer";
import type { TelemetryStore } from "./store";
import type { TriggerType } from "./types";

interface PendingSpan {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  operation: string;
  name: string;
  started_at: string;
  status: string;
  attributes: Record<string, unknown>;
  events: Array<{
    type: string;
    name: string;
    payload: Record<string, unknown>;
  }>;
  stateChanges: Array<{
    entity_type: string;
    entity_id: string;
    field: string;
    old_value?: string;
    new_value?: string;
    reason?: string;
  }>;
  errors: Array<{
    error: Error;
    recoverable: boolean;
    context?: Record<string, unknown>;
  }>;
}

export interface SpanHandle {
  spanId: string;
  traceId: string;
  event(type: string, name: string, payload?: Record<string, unknown>): void;
  stateChange(entity: {
    type: string;
    id: string;
    field: string;
    old?: string;
    new?: string;
    reason?: string;
  }): void;
  error(
    err: Error,
    recoverable?: boolean,
    context?: Record<string, unknown>,
  ): void;
  end(status?: "ok" | "error"): void;
  startChild(operation: string, name: string): SpanHandle;
}

export interface TraceHandle {
  traceId: string;
  startSpan(operation: string, name: string): SpanHandle;
  end(status?: "completed" | "error"): void;
}

export class TelemetryRecorder {
  private store: TelemetryStore;
  private pendingSpans: Map<string, PendingSpan> = new Map();

  constructor(store: TelemetryStore) {
    this.store = store;
  }

  startTrace(trigger: TriggerType, toolName?: string): TraceHandle {
    const traceId = crypto.randomUUID();
    try {
      this.store.insertTrace({
        id: traceId,
        trigger,
        tool_name: toolName ?? null,
        root_cause: null,
        started_at: new Date().toISOString(),
        duration_ms: null,
        status: "running",
      });
    } catch {
      // Fire-and-forget
    }
    return {
      traceId,
      startSpan: (operation, name) =>
        this.createSpan(traceId, null, operation, name),
      end: (status = "completed") => {
        try {
          const start = this.store.getTrace(traceId)?.started_at;
          const duration = start ? Date.now() - new Date(start).getTime() : 0;
          this.flushPendingForTrace(traceId);
          this.store.updateTrace(traceId, duration, status);
        } catch {
          // Fire-and-forget
        }
      },
    };
  }

  private createSpan(
    traceId: string,
    parentSpanId: string | null,
    operation: string,
    name: string,
  ): SpanHandle {
    const spanId = crypto.randomUUID();
    const pending: PendingSpan = {
      id: spanId,
      trace_id: traceId,
      parent_span_id: parentSpanId,
      operation,
      name,
      started_at: new Date().toISOString(),
      status: "running",
      attributes: {},
      events: [],
      stateChanges: [],
      errors: [],
    };
    this.pendingSpans.set(spanId, pending);

    return {
      spanId,
      traceId,
      event: (type, eventName, payload) => {
        if (this.pendingSpans.has(spanId)) {
          this.pendingSpans.get(spanId)?.events.push({
            type,
            name: eventName,
            payload: sanitize(payload ?? {}),
          });
        }
      },
      stateChange: (entity) => {
        if (this.pendingSpans.has(spanId)) {
          this.pendingSpans.get(spanId)?.stateChanges.push({
            entity_type: entity.type,
            entity_id: entity.id,
            field: entity.field,
            old_value: entity.old,
            new_value: entity.new,
            reason: entity.reason,
          });
        }
      },
      error: (err, recoverable = false, context) => {
        if (this.pendingSpans.has(spanId)) {
          this.pendingSpans.get(spanId)?.errors.push({
            error: err,
            recoverable,
            context,
          });
        }
      },
      end: (status = "ok") => {
        const pending = this.pendingSpans.get(spanId);
        if (pending) {
          try {
            const duration =
              Date.now() - new Date(pending.started_at).getTime();
            pending.status = status;
            this.flushSpan(pending, duration);
          } catch {
            // Fire-and-forget
          }
          this.pendingSpans.delete(spanId);
        }
      },
      startChild: (childOp, childName) =>
        this.createSpan(traceId, spanId, childOp, childName),
    };
  }

  private flushSpan(pending: PendingSpan, durationMs: number): void {
    const batch: Array<{
      type: "span" | "event" | "state_change" | "error";
      data: Record<string, unknown>;
    }> = [];

    batch.push({
      type: "span",
      data: {
        id: pending.id,
        trace_id: pending.trace_id,
        parent_span_id: pending.parent_span_id,
        operation: pending.operation,
        name: pending.name,
        started_at: pending.started_at,
        duration_ms: durationMs,
        status: pending.status,
        attributes: pending.attributes,
      },
    });

    for (const evt of pending.events) {
      batch.push({
        type: "event",
        data: {
          span_id: pending.id,
          trace_id: pending.trace_id,
          type: evt.type,
          name: evt.name,
          payload: evt.payload,
        },
      });
    }

    for (const sc of pending.stateChanges) {
      batch.push({
        type: "state_change",
        data: {
          span_id: pending.id,
          trace_id: pending.trace_id,
          entity_type: sc.entity_type,
          entity_id: sc.entity_id,
          field: sc.field,
          old_value: sc.old_value,
          new_value: sc.new_value,
          reason: sc.reason,
        },
      });
    }

    for (const err of pending.errors) {
      batch.push({
        type: "error",
        data: {
          span_id: pending.id,
          trace_id: pending.trace_id,
          error_type: err.error.constructor.name,
          message: err.error.message,
          stack_trace: err.error.stack ?? null,
          recoverable: err.recoverable ? 1 : 0,
          context: err.context ?? {},
        },
      });
    }

    this.store.flushBatch(batch);
  }

  private flushPendingForTrace(traceId: string): void {
    for (const [spanId, pending] of this.pendingSpans.entries()) {
      if (pending.trace_id === traceId) {
        try {
          const duration = Date.now() - new Date(pending.started_at).getTime();
          this.flushSpan(pending, duration);
        } catch {
          // Fire-and-forget
        }
        this.pendingSpans.delete(spanId);
      }
    }
  }
}
