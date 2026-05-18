import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KaiDB } from "../db/client";
import { registerResources } from "./resources";
import { registerHandlers } from "./handlers";

const log = (msg: string, data?: unknown) => {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), msg, ...(data ? { data } : {}) }) + "\n");
};

export function createMcpServer(db: KaiDB): McpServer {
  const server = new McpServer({
    name: "kai",
    version: "0.1.0",
  });

  server.server.onerror = (error: Error) => {
    log("mcp_server_error", { message: error.message });
  };

  registerResources(server, db);
  registerHandlers(server, db);

  return server;
}

export async function startMcpServer(dbPath: string): Promise<void> {
  const db = new KaiDB(dbPath);
  const server = createMcpServer(db);

  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("kai_mcp_server_started", { dbPath });

  const shutdown = (signal: string) => {
    log("kai_mcp_server_shutdown", { signal });
    db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
