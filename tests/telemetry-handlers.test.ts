import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { registerTelemetryHandlers } from "../src/mcp/telemetry-handlers";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function createMockServer(): {
  server: McpServer;
  tools: Map<string, { schema: unknown; handler: Function }>;
} {
  const tools = new Map<string, { schema: unknown; handler: Function }>();
  const server = {
    tool: (name: string, schema: unknown, handler: Function) => {
      tools.set(name, { schema, handler });
    },
    resource: () => {},
  } as unknown as McpServer;
  return { server, tools };
}

describe("Telemetry MCP Handlers", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-handler-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("registers 3 telemetry tools", () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    expect(tools.has("telemetry.query")).toBe(true);
    expect(tools.has("telemetry.trace")).toBe(true);
    expect(tools.has("telemetry.explain")).toBe(true);
  });

  test("telemetry.query executes SELECT", async () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const handler = tools.get("telemetry.query")!.handler;
    const result = await handler({ sql: "SELECT * FROM telemetry_traces_v1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.rows).toHaveLength(1);
  });

  test("telemetry.query rejects non-SELECT", async () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    const handler = tools.get("telemetry.query")!.handler;
    const result = await handler({ sql: "DROP TABLE runtime_traces" });
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeDefined();
  });

  test("telemetry.trace returns full trace with spans", async () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    store.insertTrace({
      id: "t2", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 50, status: "completed",
    });
    store.insertSpan({
      id: "s1", trace_id: "t2", parent_span_id: null, operation: "mcp_tool",
      name: "test", started_at: new Date().toISOString(),
      duration_ms: 50, status: "ok", attributes: {},
    });
    store.insertEvent({
      span_id: "s1", trace_id: "t2", type: "info", name: "done", payload: {},
    });
    const handler = tools.get("telemetry.trace")!.handler;
    const result = await handler({ traceId: "t2" });
    const data = JSON.parse(result.content[0].text);
    expect(data.trace.id).toBe("t2");
    expect(data.spans).toHaveLength(1);
    expect(data.events).toHaveLength(1);
    expect(data.suggested_actions).toEqual([]);
  });

  test("telemetry.trace returns error for missing trace", async () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    const handler = tools.get("telemetry.trace")!.handler;
    const result = await handler({ traceId: "nonexistent" });
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe("trace_not_found");
  });

  test("telemetry.explain returns stats summary", async () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    store.insertTrace({
      id: "t3", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const handler = tools.get("telemetry.explain")!.handler;
    const result = await handler({ question: "health?" });
    const data = JSON.parse(result.content[0].text);
    expect(data.summary).toBeDefined();
  });
});
