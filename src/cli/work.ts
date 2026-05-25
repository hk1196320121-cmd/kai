import type { Command } from "commander";
import { handleWorkStart } from "./work/start";
import { handleWorkList, handleWorkStatus } from "./work/status";

// --- Re-exports from extracted modules ---

export { scanGitHistory } from "./work/git-scan";

// --- CLI Commands ---

export function registerWorkCommands(program: Command): void {
  const work = program.command("work").description("Workspace management");

  work
    .command("start")
    .description("Start a new workspace with cold start profile bootstrapping")
    .option("--reset", "Force re-interview even if coldstart data exists")
    .action(async (options: { reset?: boolean }) => {
      await handleWorkStart({ reset: options.reset });
    });

  work
    .command("status")
    .description("Show current workspace status")
    .action(() => {
      handleWorkStatus();
    });

  work
    .command("list")
    .description("List all workspaces")
    .action(() => {
      handleWorkList();
    });
}
