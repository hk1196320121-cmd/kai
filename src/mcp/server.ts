import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KaiDB } from "../db/client";
import { registerResources } from "./resources";
import { registerHandlers } from "./handlers";

export function createMcpServer(db: KaiDB): McpServer {
  const server = new McpServer({
    name: "kai",
    version: "0.1.0",
  });

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

  const log = (msg: string) => process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), msg }) + "\n");
  log("kai mcp server started on stdio");

  process.on("SIGTERM", () => {
    log("kai mcp server shutting down");
    db.close();
    process.exit(0);
  });
}
