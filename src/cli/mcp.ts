import { Command } from "commander";
import { startMcpServer } from "../mcp/server";
import { getDbPath } from "./utils";

export function registerMcpCommands(program: Command): void {
  const mcp = program.command("mcp").description("MCP server commands");

  mcp.command("serve")
    .description("Start MCP server on stdio")
    .option("--db <path>", "Database path", getDbPath())
    .action(async (opts) => {
      try {
        await startMcpServer(opts.db);
      } catch (err) {
        process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), error: (err as Error).message }) + "\n");
        process.exit(1);
      }
    });
}