import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { registerTelemetryResources } from "../src/mcp/telemetry-resources";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function createMockServer(): {
  server: McpServer;
  resources: Map<string, { handler: Function }>;
} {
  const resources = new Map<string, { handler: Function }>();
  const server = {
    resource: (name: string, _uriOrTemplate: unknown, handler: Function) => {
      resources.set(name, { handler });
    },
    tool: () => {},
  } as unknown as McpServer;
  return { server, resources };
}

describe("Telemetry MCP Resources", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-res-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("registers 3 telemetry resources", () => {
    const { server, resources } = createMockServer();
    registerTelemetryResources(server, store);
    expect(resources.has("telemetry-trace")).toBe(true);
    expect(resources.has("telemetry-recent-errors")).toBe(true);
    expect(resources.has("telemetry-health")).toBe(true);
  });

  test("telemetry-recent-errors returns recent errors", async () => {
    const { server, resources } = createMockServer();
    registerTelemetryResources(server, store);
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "error",
    });
    store.insertSpan({
      id: "s1", trace_id: "t1", parent_span_id: null, operation: "mcp_tool",
      name: "test", started_at: new Date().toISOString(),
      duration_ms: 10, status: "error", attributes: {},
    });
    store.insertError({
      span_id: "s1", trace_id: "t1", error_type: "TestError",
      message: "test error", stack_trace: null, recoverable: 0, context: {},
    });
    const handler = resources.get("telemetry-recent-errors")!.handler;
    const result = await handler({ href: "kai://telemetry/recent-errors" });
    const data = JSON.parse(result.contents[0].text);
    expect(data.errors.length).toBeGreaterThanOrEqual(1);
  });

  test("telemetry-health returns health stats", async () => {
    const { server, resources } = createMockServer();
    registerTelemetryResources(server, store);
    const handler = resources.get("telemetry-health")!.handler;
    const result = await handler({ href: "kai://telemetry/health" });
    const data = JSON.parse(result.contents[0].text);
    expect(data.traceCount).toBeDefined();
    expect(data.errorRate).toBeDefined();
    expect(data.p95LatencyMs).toBeDefined();
  });
});
