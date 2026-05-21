import {
  type McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTelemetryStats } from "../core/telemetry/stats";
import type { TelemetryStore } from "../core/telemetry/store";

export function registerTelemetryResources(
  server: McpServer,
  store: TelemetryStore,
): void {
  // 1. kai://telemetry/trace/{traceId}
  const traceTemplate = new ResourceTemplate(
    "kai://telemetry/trace/{traceId}",
    {
      list: async () => {
        const traces = store.queryTelemetry(
          "SELECT id, tool_name FROM telemetry_traces_v1 ORDER BY started_at DESC LIMIT 20",
        );
        return {
          resources: traces.map((t) => ({
            uri: `kai://telemetry/trace/${t.id}`,
            name: `Trace: ${t.tool_name ?? t.id}`,
          })),
        };
      },
    },
  );
  server.resource(
    "telemetry-trace",
    traceTemplate,
    async (uri, variables) => {
      const traceId = Array.isArray(variables.traceId)
        ? variables.traceId[0]
        : variables.traceId;
      const trace = store.getTrace(traceId);
      const spans = store.getSpansByTrace(traceId);
      const events = store.getEventsByTrace(traceId);
      const stateChanges = store.getStateChangesByTrace(traceId);
      const errors = store.getErrorsByTrace(traceId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              trace,
              spans,
              events,
              stateChanges,
              errors,
            }),
          },
        ],
      };
    },
  );

  // 2. kai://telemetry/recent-errors
  server.resource(
    "telemetry-recent-errors",
    "kai://telemetry/recent-errors",
    async (uri) => {
      const errors = store.getRecentErrors(50);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ errors }),
          },
        ],
      };
    },
  );

  // 3. kai://telemetry/health
  server.resource(
    "telemetry-health",
    "kai://telemetry/health",
    async (uri) => {
      const stats = getTelemetryStats(store, 24);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(stats),
          },
        ],
      };
    },
  );
}
