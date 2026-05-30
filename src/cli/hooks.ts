import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { AutopilotManager } from "../autopilot/index";

const DEFAULT_HOOKS_DIR = join(homedir(), ".claude", "hooks", "kai");
const DEFAULT_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

export function registerHooksCommands(program: Command): void {
  const hooks = program
    .command("hooks")
    .description("Manage Kai autopilot hooks");

  hooks
    .command("install")
    .description("Install autopilot hooks into Claude Code settings")
    .option("--hooks-dir <dir>", "Hook scripts directory", DEFAULT_HOOKS_DIR)
    .option(
      "--settings <path>",
      "Claude Code settings.json path",
      DEFAULT_SETTINGS_PATH,
    )
    .action((opts) => {
      const manager = new AutopilotManager(opts.hooksDir);
      manager.install(opts.settings);
      console.log("Kai autopilot hooks installed.");
      console.log(`  Scripts: ${opts.hooksDir}`);
      console.log(`  Settings: ${opts.settings}`);
    });

  hooks
    .command("uninstall")
    .description("Remove Kai autopilot hooks from Claude Code settings")
    .option(
      "--settings <path>",
      "Claude Code settings.json path",
      DEFAULT_SETTINGS_PATH,
    )
    .action((opts) => {
      const manager = new AutopilotManager(DEFAULT_HOOKS_DIR);
      manager.uninstall(opts.settings);
      console.log("Kai autopilot hooks uninstalled.");
    });

  hooks
    .command("status")
    .description("Show current hook installation status")
    .option("--hooks-dir <dir>", "Hook scripts directory", DEFAULT_HOOKS_DIR)
    .option(
      "--settings <path>",
      "Claude Code settings.json path",
      DEFAULT_SETTINGS_PATH,
    )
    .action((opts) => {
      // Check if scripts exist
      const scripts = [
        "kai-session-start.cjs",
        "kai-auto-observe.cjs",
        "kai-stop.cjs",
      ];
      const scriptStatus = scripts.map((s) => ({
        name: s,
        exists: existsSync(join(opts.hooksDir, s)),
      }));

      // Check settings.json for hooks
      const settingsHooks: string[] = [];
      if (existsSync(opts.settings)) {
        try {
          const settings = JSON.parse(readFileSync(opts.settings, "utf-8"));
          const allCommands: string[] = [];
          for (const groups of Object.values(settings.hooks || {}) as Array<
            Array<{ hooks?: Array<{ command?: string }> }>
          >) {
            for (const group of groups) {
              for (const hook of group.hooks || []) {
                if (
                  hook.command &&
                  /kai-(session-start|auto-observe|stop)/.test(hook.command)
                ) {
                  allCommands.push(hook.command);
                }
              }
            }
          }
          settingsHooks.push(...allCommands);
        } catch {
          // Ignore parse errors
        }
      }

      console.log("Kai Autopilot Hooks Status");
      console.log("---");
      console.log("Scripts:");
      for (const s of scriptStatus) {
        console.log(`  ${s.exists ? "✓" : "✗"} ${s.name}`);
      }
      console.log(`Settings hooks: ${settingsHooks.length} registered`);
      for (const cmd of settingsHooks) {
        console.log(`  → ${cmd}`);
      }
    });
}
