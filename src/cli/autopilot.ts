import { Command } from "commander";
import { join } from "node:path";
import { homedir } from "node:os";
import { AutopilotManager } from "../autopilot/index";

const DEFAULT_DB_PATH = join(homedir(), ".kai", "kai.db");

export function registerAutopilotCommands(program: Command): void {
  const autopilot = program.command("autopilot").description("Autopilot status and management");

  autopilot
    .command("status")
    .description("Show autopilot session history and active session")
    .option("--db <path>", "Kai database path", DEFAULT_DB_PATH)
    .action((opts) => {
      const manager = new AutopilotManager(join(homedir(), ".claude", "hooks", "kai"));
      const { sessions, activeSession } = manager.status(opts.db);

      if (sessions.length === 0) {
        console.log("No autopilot sessions recorded yet.");
        console.log("Sessions are created automatically when Claude Code starts with Kai hooks installed.");
        return;
      }

      console.log("Kai Autopilot Sessions");
      console.log("---");

      if (activeSession) {
        console.log(`Active: ${activeSession.session_id} (started ${activeSession.started_at})`);
        console.log();
      }

      console.log("Recent sessions:");
      for (const s of sessions) {
        const status =
          s.derivation_status === "completed"
            ? "✓"
            : s.derivation_status === "failed"
              ? "✗"
              : s.derivation_status === "skipped"
                ? "—"
                : "…";
        const duration = s.stopped_at
          ? ` (${Math.round((new Date(s.stopped_at).getTime() - new Date(s.started_at).getTime()) / 60000)}min)`
          : " (active)";
        console.log(`  ${status} ${s.session_id} — ${s.observations_count} obs, ${s.traits_derived} traits${duration}`);
      }
    });
}
