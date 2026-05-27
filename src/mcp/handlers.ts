import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProfileEngine } from "../core/profile/engine";
import { ProvenanceEngine } from "../core/profile/provenance";
import type { TelemetryRecorder } from "../core/telemetry/recorder";
import type { KaiDB } from "../db/client";
import { registerDeriveHandlers } from "./handlers/derive";
import { registerObserveHandlers } from "./handlers/observe";
import { registerProfileHandlers } from "./handlers/profile";

export function registerHandlers(
  server: McpServer,
  db: KaiDB,
  telemetry: TelemetryRecorder | null = null,
): void {
  const engine = new ProfileEngine(db);
  const provenance = new ProvenanceEngine(engine);

  registerProfileHandlers(server, { engine, provenance, telemetry });
  registerObserveHandlers(server, { engine, telemetry });
  registerDeriveHandlers(server, { engine, db, telemetry });
}
