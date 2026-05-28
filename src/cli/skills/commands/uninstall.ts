import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import * as readline from "node:readline";
import type { Command } from "commander";
import { join } from "node:path";
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
        const msg = err instanceof Error ? err.message : String(err);
        console.log(status("error", `Failed to remove skill files: ${msg}`));
        return;
      }

      // --- Remove workflow commands ---
      const commandsDir = join(homedir(), ".claude", "commands", "kai");
      if (existsSync(commandsDir)) {
        try {
          rmSync(commandsDir, { recursive: true, force: true });
          console.log(status("success", "Workflow commands removed."));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(status("warning", `Could not remove commands: ${msg}`));
        }
      }

      // --- Remove hook scripts ---
      const hooksDir = join(homedir(), ".claude", "hooks", "kai");
      if (existsSync(hooksDir)) {
        try {
          rmSync(hooksDir, { recursive: true, force: true });
          console.log(status("success", "Hook scripts removed."));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(status("warning", `Could not remove hooks: ${msg}`));
        }
      }

      try {
        await target.removeMcp();
        console.log(
          status("success", "MCP configuration removed from ~/.claude.json."),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(status("warning", `Could not remove MCP config: ${msg}`));
      }

      try {
        await target.removeSettingsHooks();
        console.log(
          status("success", "Hooks removed from ~/.claude/settings.json."),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(status("warning", `Could not remove hooks: ${msg}`));
      }
    });
}
