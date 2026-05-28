import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { dim, header, status } from "../../format";
import { buildSkillConfigs } from "../compiler";
import { isKaiHook } from "../hooks";
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
          const msg = err instanceof Error ? err.message : String(err);
          console.log(status("error", `Failed to reinstall: ${msg}`));
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
        process.exitCode = 1;
        return;
      }

      console.log(status("success", "Installation valid."));

      // Read manifest (already validated above)
      const manifestPath = join(target.skillInstallPath, "manifest.json");
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

      // Check for new/removed tools
      const configs = buildSkillConfigs();
      const manifestTools = new Set(
        Object.values(manifest.skills).flat() as string[],
      );
      const currentTools = configs.flatMap((c) => c.tools.map((t) => t.toolId));
      const currentToolSet = new Set(currentTools);
      const newTools = currentTools.filter((t) => !manifestTools.has(t));
      const removedTools = [...manifestTools].filter(
        (t) => !currentToolSet.has(t),
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

      // --- Validate workflow commands ---
      const commandsDir = target.commandsDir;
      if (!existsSync(commandsDir)) {
        console.log(
          status(
            "warning",
            "No workflow commands found. Run `kai skills install` to generate.",
          ),
        );
      } else {
        const { WORKFLOWS } = await import("../workflows/definitions");
        const expectedCommands = WORKFLOWS.map((w) => `${w.name}.md`);
        const existingFiles = readdirSync(commandsDir).filter((f) =>
          f.endsWith(".md"),
        );
        const missing = expectedCommands.filter(
          (f) => !existingFiles.includes(f),
        );
        const extra = existingFiles.filter(
          (f) => !expectedCommands.includes(f),
        );

        if (missing.length > 0) {
          console.log(
            status(
              "warning",
              `Missing ${missing.length} command(s): ${missing.join(", ")}`,
            ),
          );
        }
        if (extra.length > 0) {
          console.log(status("info", `Extra command(s): ${extra.join(", ")}`));
        }
        if (missing.length === 0 && extra.length === 0) {
          console.log(
            status(
              "success",
              `All ${expectedCommands.length} workflow commands present.`,
            ),
          );
        }
      }

      // --- Validate hook scripts ---
      const hooksDir = target.hooksDir;
      const { KAI_HOOK_SCRIPTS: expectedHooks } = await import("../hooks");
      if (!existsSync(hooksDir)) {
        console.log(
          status(
            "warning",
            "No Kai hook scripts found. Run `kai skills install` to generate.",
          ),
        );
      } else {
        const hookFiles = readdirSync(hooksDir).filter((f) =>
          f.endsWith(".cjs"),
        );
        const missingHooks = expectedHooks.filter(
          (h) => !hookFiles.includes(h),
        );
        if (missingHooks.length > 0) {
          console.log(
            status(
              "warning",
              `Missing hook script(s): ${missingHooks.join(", ")}`,
            ),
          );
        } else {
          console.log(status("success", "All hook scripts present."));
        }
      }

      // --- Validate hooks in settings.json ---
      const settingsPath = target.settingsJsonPath;
      if (existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
          const hasHook = (eventType: string) =>
            (settings?.hooks?.[eventType] ?? []).some(
              (g: Record<string, unknown>) =>
                ((g.hooks as unknown[]) ?? []).some(
                  (h) =>
                    typeof h === "object" &&
                    h !== null &&
                    "command" in h &&
                    typeof (h as Record<string, unknown>).command ===
                      "string" &&
                    isKaiHook((h as Record<string, unknown>).command as string),
                ),
            );
          const hasSessionStart = hasHook("SessionStart");
          const hasPostToolUse = hasHook("PostToolUse");

          if (!hasSessionStart) {
            console.log(
              status("warning", "SessionStart hook not found in settings.json"),
            );
          }
          if (!hasPostToolUse) {
            console.log(
              status("warning", "PostToolUse hook not found in settings.json"),
            );
          }
          if (hasSessionStart && hasPostToolUse) {
            console.log(
              status("success", "All hooks registered in settings.json"),
            );
          }
        } catch {
          console.log(
            status("warning", "Cannot parse settings.json for hook validation"),
          );
        }
      } else {
        console.log(
          status(
            "warning",
            "~/.claude/settings.json not found. Hooks not registered.",
          ),
        );
      }

      for (const warn of validation.warnings) {
        console.log(status("warning", warn));
      }
    });
}
