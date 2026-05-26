import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { dim, header, status } from "../../format";
import { buildSkillConfigs } from "../compiler";
import { ClaudeCodeTarget } from "../targets/claude-code";
import { installSkills } from "./install";

export function registerDoctorCommand(skills: Command): void {
  skills
    .command("doctor")
    .description("Validate installed skills against current schemas")
    .option("--fix", "Reinstall skills to fix issues")
    .action(async (opts: { fix?: boolean }) => {
      const target = new ClaudeCodeTarget();

      if (opts.fix) {
        console.log("Reinstalling skills...");
        try {
          await installSkills({ target: "claude-code", force: true });
          console.log(status("success", "Skills reinstalled successfully."));
        } catch (err) {
          console.log(
            status("error", `Failed to reinstall: ${(err as Error).message}`),
          );
        }
        return;
      }

      console.log(header("Kai Skills Doctor"));
      console.log();

      const validation = target.validateInstallation();

      if (!validation.valid) {
        for (const err of validation.errors) {
          console.log(status("error", err));
        }
        console.log();
        console.log(dim("Run `kai skills doctor --fix` to reinstall."));
        process.exit(1);
      }

      console.log(status("success", "Installation valid."));

      // Check version
      const manifestPath = join(target.skillInstallPath, "manifest.json");
      if (!existsSync(manifestPath)) {
        console.log(status("warning", "No manifest.json found."));
        return;
      }

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const pkg = JSON.parse(
        readFileSync(
          new URL("../../../../package.json", import.meta.url),
          "utf-8",
        ),
      );

      if (manifest.kaiVersion !== pkg.version) {
        console.log(
          status(
            "warning",
            `Skills generated with Kai v${manifest.kaiVersion}. Current: v${pkg.version}.`,
          ),
        );
        console.log(dim("  Run `kai skills install` to update."));
      } else {
        console.log(status("info", `Version: v${pkg.version}`));
      }

      // Check for new tools not in manifest
      const configs = buildSkillConfigs();
      const manifestTools = new Set(
        Object.values(manifest.skills).flat() as string[],
      );
      const currentTools = configs.flatMap((c) => c.tools.map((t) => t.toolId));
      const newTools = currentTools.filter((t) => !manifestTools.has(t));
      const removedTools = [...manifestTools].filter(
        (t) => !currentTools.includes(t),
      );

      if (newTools.length > 0) {
        console.log(
          status(
            "info",
            `${newTools.length} new tool(s) available: ${newTools.join(", ")}`,
          ),
        );
        console.log(dim("  Run `kai skills install` to add."));
      }

      if (removedTools.length > 0) {
        console.log(
          status(
            "warning",
            `${removedTools.length} tool(s) removed: ${removedTools.join(", ")}`,
          ),
        );
      }

      for (const warn of validation.warnings) {
        console.log(status("warning", warn));
      }
    });
}
