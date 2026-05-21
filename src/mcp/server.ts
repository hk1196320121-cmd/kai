import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TelemetryRecorder } from "../core/telemetry/recorder";
import { TelemetryStore } from "../core/telemetry/store";
import { KaiDB } from "../db/client";
import { LLMProvider } from "../llm/provider";
import { registerHandlers } from "./handlers";
import { registerOrchestratorHandlers } from "./orchestrator-handlers";
import { registerPromptHandlers } from "./prompt-handlers";
import { registerPromptResources } from "./prompt-resources";
import { registerResources } from "./resources";
import { registerTelemetryHandlers } from "./telemetry-handlers";
import { registerTelemetryResources } from "./telemetry-resources";
import { log } from "./utils";

export function createMcpServer(db: KaiDB): McpServer {
  const server = new McpServer({
    name: "kai",
    version: "0.1.0",
  });

  server.server.onerror = (error: Error) => {
    log("mcp_server_error", { message: error.message });
  };

  // Telemetry setup
  const telemetryStore = new TelemetryStore(db);
  const telemetry = new TelemetryRecorder(telemetryStore);
  const llmProvider = new LLMProvider();

  registerResources(server, db, telemetry);
  registerHandlers(server, db, telemetry);
  registerOrchestratorHandlers(server, db, telemetry);
  registerPromptResources(server, db);
  registerPromptHandlers(server, db);
  registerTelemetryHandlers(server, telemetryStore, llmProvider);
  registerTelemetryResources(server, telemetryStore);

  return server;
}

export async function startMcpServer(dbPath: string): Promise<void> {
  const db = new KaiDB(dbPath);
  const server = createMcpServer(db);

  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("kai_mcp_server_started", { dbPath });

  // Start telemetry retention pruning (24h interval)
  const pruneInterval = setInterval(
    () => {
      try {
        let retentionDays = parseInt(
          process.env.KAI_TELEMETRY_RETENTION_DAYS ?? "30",
          10,
        );
        if (!Number.isFinite(retentionDays) || retentionDays < 1)
          retentionDays = 30;
        new TelemetryStore(db).pruneTelemetry(retentionDays);
      } catch {
        // Fire-and-forget
      }
    },
    24 * 60 * 60 * 1000,
  );

  const shutdown = (signal: string) => {
    log("kai_mcp_server_shutdown", { signal });
    clearInterval(pruneInterval);
    db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
