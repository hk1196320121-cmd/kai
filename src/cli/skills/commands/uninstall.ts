import * as readline from "node:readline";
import type { Command } from "commander";
import { dim, header, status } from "../../format";
import { detectPlatforms, getTarget, validateTargetName } from "../targets/registry";

export function registerUninstallCommand(skills: Command): void {
  skills
    .command("uninstall")
    .description("Remove all installed Kai skills")
    .option("--target <target>", "Target agent to uninstall from (or 'all')", "all")
    .option("--force", "Skip confirmation prompt")
    .action(async (opts: { target?: string; force?: boolean }) => {
      const targetFlag = opts.target ?? "all";

      const targetNames = targetFlag === "all"
        ? detectPlatforms()
        : (() => {
          validateTargetName(targetFlag);
          return [targetFlag];
        })();

      if (targetNames.length === 0) {
        console.log(dim("No installed platforms detected."));
        return;
      }

      console.log(header("Kai Skills Uninstall"));
      console.log(`Targets: ${targetNames.join(", ")}`);
      console.log();

      if (!opts.force) {
        const confirmed = await new Promise<boolean>((resolve) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          // SIGINT handler to prevent Bun readline deadlock
          const onSigint = () => {
            rl.close();
            process.off("SIGINT", onSigint);
            resolve(false);
          };
          process.on("SIGINT", onSigint);
          rl.question("Remove all Kai skills? [y/N] ", (answer) => {
            rl.close();
            process.off("SIGINT", onSigint);
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

      for (const name of targetNames) {
        try {
          const adapter = getTarget(name);

          // Remove skill files + commands + hooks
          await adapter.removeSkills();
          console.log(status("success", `${name}: Skill files removed.`));

          // Remove MCP config
          await adapter.removeMcp();
          console.log(status("success", `${name}: MCP configuration removed.`));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(status("error", `${name}: ${msg}`));
        }
      }
    });
}
