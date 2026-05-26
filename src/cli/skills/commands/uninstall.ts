import { existsSync, rmSync } from "node:fs";
import * as readline from "node:readline";
import type { Command } from "commander";
import { dim, header, status } from "../../format";
import { ClaudeCodeTarget } from "../targets/claude-code";

export function registerUninstallCommand(skills: Command): void {
  skills
    .command("uninstall")
    .description("Remove all installed Kai skills")
    .option("--force", "Skip confirmation prompt")
    .action(async (opts: { force?: boolean }) => {
      const target = new ClaudeCodeTarget();
      const installPath = target.skillInstallPath;

      if (!existsSync(installPath)) {
        console.log(dim("No skills installed."));
        return;
      }

      console.log(header("Kai Skills Uninstall"));
      console.log(`This will remove: ${installPath}`);
      console.log();

      // Confirmation prompt (skip with --force)
      if (!opts.force) {
        const confirmed = await new Promise<boolean>((resolve) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question("Remove all Kai skills? [y/N] ", (answer) => {
            rl.close();
            resolve(
              answer.toLowerCase() === "y" || answer.toLowerCase() === "yes",
            );
          });
        });

        if (!confirmed) {
          console.log(dim("Uninstall cancelled."));
          return;
        }
      }

      try {
        rmSync(installPath, { recursive: true, force: true });
        console.log(status("success", "Skill files removed."));
      } catch (err) {
        console.log(
          status(
            "error",
            `Failed to remove skill files: ${(err as Error).message}`,
          ),
        );
      }

      try {
        await target.removeMcp();
        console.log(
          status("success", "MCP configuration removed from ~/.claude.json."),
        );
      } catch (err) {
        console.log(
          status(
            "warning",
            `Could not remove MCP config: ${(err as Error).message}`,
          ),
        );
      }
    });
}
