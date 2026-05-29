import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { dim, header, status } from "../../format";
import { buildSkillConfigs } from "../compiler";
import { isKaiHook } from "../hooks";
import {
  detectPlatforms,
  getTarget,
  validateTargetName,
} from "../targets/registry";
import { installSkills } from "./install";

export function registerDoctorCommand(skills: Command): void {
  skills
    .command("doctor")
    .description("Validate installed skills against current schemas")
    .option("--target <target>", "Target agent to check (or 'all')", "all")
    .option("--fix", "Reinstall skills to fix issues")
    .action(async (opts: { target?: string; fix?: boolean }) => {
      const targetFlag = opts.target ?? "all";

      if (opts.fix) {
        const targetNames =
          targetFlag === "all" ? detectPlatforms() : [targetFlag];
        let fixFailed = false;
        for (const name of targetNames) {
          console.log(`Reinstalling skills for ${name}...`);
          try {
            const rc = await installSkills({
              target: name,
              force: true,
              configureMcp: true,
            });
            if (rc !== 0) {
              fixFailed = true;
              console.log(
                status("error", `${name}: Reinstall returned errors.`),
              );
            } else {
              console.log(
                status("success", `${name}: Skills reinstalled successfully.`),
              );
            }
          } catch (err) {
            fixFailed = true;
            const msg = err instanceof Error ? err.message : String(err);
            console.log(
              status("error", `${name}: Failed to reinstall: ${msg}`),
            );
          }
        }
        if (fixFailed) {
          process.exitCode = 1;
        }
        return;
      }

      console.log(header("Kai Skills Doctor"));
      console.log();

      const targetNames =
        targetFlag === "all"
          ? detectPlatforms()
          : (() => {
              validateTargetName(targetFlag);
              return [targetFlag];
            })();

      if (targetNames.length === 0) {
        console.log(
          dim(
            "No installed platforms detected. Run `kai skills install` first.",
          ),
        );
        return;
      }

      let hasFailure = false;
      for (const name of targetNames) {
        const healthy = await runDoctorForTarget(name);
        if (!healthy) hasFailure = true;
        console.log();
      }
      if (hasFailure) {
        process.exitCode = 1;
      }
    });
}

async function runDoctorForTarget(targetName: string): Promise<boolean> {
  const adapter = getTarget(targetName);
  const caps = adapter.capabilities();

  console.log(`Target: ${targetName}`);

  // --- Validate manifest ---
  const validation = adapter.validateInstallation();

  if (!validation.valid) {
    for (const err of validation.errors) {
      console.log(status("error", err));
    }
    console.log(dim("  Run `kai skills doctor --fix` to reinstall."));
    return false;
  }

  console.log(status("success", "Installation valid."));

  // Read manifest
  const manifestPath = join(adapter.skillInstallPath, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  const pkg = JSON.parse(
    readFileSync(new URL("../../../../package.json", import.meta.url), "utf-8"),
  );

  if (manifest.kaiVersion !== pkg.version) {
    console.log(
      status(
        "warning",
        `Skills generated with Kai v${manifest.kaiVersion}. Current: v${pkg.version}.`,
      ),
    );
  } else {
    console.log(status("info", `Version: v${pkg.version}`));
  }

  // --- Check for new/removed tools ---
  const configs = buildSkillConfigs();
  const manifestTools = new Set(
    Object.values(manifest.skills).flat() as string[],
  );
  const currentTools = configs.flatMap((c) => c.tools.map((t) => t.toolId));
  const currentToolSet = new Set(currentTools);
  const newTools = currentTools.filter((t) => !manifestTools.has(t));
  const removedTools = [...manifestTools].filter((t) => !currentToolSet.has(t));

  if (newTools.length > 0) {
    console.log(
      status(
        "info",
        `${newTools.length} new tool(s) available: ${newTools.join(", ")}`,
      ),
    );
  }

  if (removedTools.length > 0) {
    console.log(
      status(
        "warning",
        `${removedTools.length} tool(s) removed: ${removedTools.join(", ")}`,
      ),
    );
  }

  // --- Capability-gated checks ---

  // Commands check
  if (caps.commands && adapter.commandsDir) {
    const commandsDir = adapter.commandsDir;
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
      const extra = existingFiles.filter((f) => !expectedCommands.includes(f));

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
  } else {
    console.log(
      status("info", "Commands: not supported (expected for this platform)"),
    );
  }

  // Hooks check
  if (caps.hooks && adapter.hooksDir) {
    const hooksDir = adapter.hooksDir;
    const { KAI_HOOK_SCRIPTS: expectedHooks } = await import("../hooks");
    if (!existsSync(hooksDir)) {
      console.log(
        status(
          "warning",
          "No Kai hook scripts found. Run `kai skills install` to generate.",
        ),
      );
    } else {
      const hookFiles = readdirSync(hooksDir).filter((f) => f.endsWith(".cjs"));
      const missingHooks = expectedHooks.filter((h) => !hookFiles.includes(h));
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

    // Validate hooks in settings.json
    const settingsPath = adapter.settingsPath;
    if (settingsPath && existsSync(settingsPath)) {
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
                  typeof (h as Record<string, unknown>).command === "string" &&
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
        status("warning", "settings.json not found. Hooks not registered."),
      );
    }
  } else {
    console.log(
      status("info", "Hooks: not supported (expected for this platform)"),
    );
  }

  // MCP check — actually validate registration
  if (caps.mcp) {
    const mcpValidation = adapter.validateMcp();
    if (mcpValidation.valid) {
      console.log(status("success", "MCP server registered."));
    } else {
      for (const err of mcpValidation.errors) {
        console.log(status("error", err));
      }
    }
    for (const warn of mcpValidation.warnings) {
      console.log(status("warning", warn));
    }
  } else {
    console.log(
      status("info", "MCP: not supported (expected for this platform)"),
    );
  }

  for (const warn of validation.warnings) {
    console.log(status("warning", warn));
  }

  return true;
}
