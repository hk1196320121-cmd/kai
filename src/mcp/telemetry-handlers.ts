import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { explainTelemetry } from "../core/telemetry/explain";
import type { TelemetryStore } from "../core/telemetry/store";
import type { LLMProvider } from "../llm/provider";
import {
  TelemetryExplainSchema,
  TelemetryQuerySchema,
  TelemetryTraceSchema,
} from "./telemetry-schema";

function textContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export function registerTelemetryHandlers(
  server: McpServer,
  store: TelemetryStore,
  llm: LLMProvider | null,
): void {
  // telemetry.query
  server.tool(
    "telemetry.query",
    TelemetryQuerySchema,
    async ({ sql }: { sql: string }) => {
      try {
        const rows = store.queryTelemetry(sql);
        return textContent({ rows, count: rows.length });
      } catch (err) {
        return textContent({
          error: "query_failed",
          message: (err as Error).message,
        });
      }
    },
  );

  // telemetry.trace
  server.tool(
    "telemetry.trace",
    TelemetryTraceSchema,
    async ({ traceId }: { traceId: string }) => {
      const trace = store.getTrace(traceId);
      if (!trace) {
        return textContent({ error: "trace_not_found", traceId });
      }
      const spans = store.getSpansByTrace(traceId);
      const events = store.getEventsByTrace(traceId);
      const stateChanges = store.getStateChangesByTrace(traceId);
      const errors = store.getErrorsByTrace(traceId);

      const suggested_actions: Array<{
        description: string;
        past_occurrences: number;
        last_seen: string;
      }> = [];
      if (errors.length > 0) {
        try {
          for (const err of errors.slice(0, 3)) {
            const similar = store.getSimilarErrors(err.error_type, 3);
            for (const s of similar) {
              suggested_actions.push({
                description: `${s.error_type}: ${s.message}`,
                past_occurrences: s.count,
                last_seen: s.last_seen,
              });
            }
          }
        } catch {
          // Fire-and-forget
        }
      }

      return textContent({
        trace,
        spans,
        events,
        stateChanges,
        errors,
        suggested_actions,
      });
    },
  );

  // telemetry.explain
  server.tool(
    "telemetry.explain",
    TelemetryExplainSchema,
    async ({ question }: { question: string }) => {
      const result = await explainTelemetry(store, question, llm);
      return textContent(result);
    },
  );
}
