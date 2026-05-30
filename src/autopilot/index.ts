export type { NudgeTemplate, AutopilotSession, HookInput } from "./types";

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AutopilotSession } from "./types";
import { generateSessionStartHook } from "../cli/skills/hooks/session-start";
import { generateAutoObserveHook } from "../cli/skills/hooks/auto-observe";
import { generateStopHook } from "../cli/skills/hooks/stop";
import {
  mergeHookIntoSettings,
  removeHookFromSettings,
  type HookConfig,
} from "../cli/skills/hooks";

const HOOK_SCRIPTS = [
  "kai-session-start.cjs",
  "kai-auto-observe.cjs",
  "kai-stop.cjs",
] as const;

const HOOK_IDS = [
  "kai-session-start",
  "kai-auto-observe",
  "kai-stop",
] as const;

export class AutopilotManager {
  constructor(private hooksDir: string) {}

  /** Install all autopilot hooks: write scripts + derive module + merge into settings.json */
  install(settingsPath: string): void {
    mkdirSync(this.hooksDir, { recursive: true });

    // Write hook scripts
    writeFileSync(
      join(this.hooksDir, HOOK_SCRIPTS[0]),
      generateSessionStartHook(),
    );
    writeFileSync(
      join(this.hooksDir, HOOK_SCRIPTS[1]),
      generateAutoObserveHook(),
    );
    writeFileSync(join(this.hooksDir, HOOK_SCRIPTS[2]), generateStopHook());

    // [D7/D17] Compile derive-shared to kai-derive.cjs
    try {
      const deriveSourcePath = require.resolve("./derive-shared");
      if (existsSync(deriveSourcePath)) {
        const { transpileSync } = require("bun");
        const source = readFileSync(deriveSourcePath, "utf-8");
        const transpiled = transpileSync(source, undefined, { target: "cjs" });
        writeFileSync(join(this.hooksDir, "kai-derive.cjs"), transpiled);
      }
    } catch {
      // Non-critical — Stop hook will fall back to skipping derivation
    }

    // Merge each hook config into settings.json
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }

    const configs = this.getHookConfigs();
    for (const config of configs) {
      settings = mergeHookIntoSettings(settings, config);
    }

    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  /** Remove all Kai hooks from settings.json */
  uninstall(settingsPath: string): void {
    if (!existsSync(settingsPath)) return;
    let settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const eventTypes = ["SessionStart", "PostToolUse", "Stop"];
    for (const eventType of eventTypes) {
      for (const hookId of HOOK_IDS) {
        settings = removeHookFromSettings(settings, { eventType, hookId });
      }
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  /** Show current autopilot status */
  status(dbPath: string): {
    sessions: AutopilotSession[];
    activeSession: AutopilotSession | null;
  } {
    if (!existsSync(dbPath)) {
      return { sessions: [], activeSession: null };
    }
    const { Database } = require("bun:sqlite");
    const db = new Database(dbPath, { readonly: true });

    const sessions = db
      .query("SELECT * FROM autopilot_sessions ORDER BY started_at DESC LIMIT 10")
      .all() as AutopilotSession[];

    const activeSession = sessions.find((s) => s.stopped_at === null) ?? null;

    db.close();
    return { sessions, activeSession };
  }

  private getHookConfigs(): HookConfig[] {
    return [
      {
        eventType: "SessionStart",
        command: `bun "${join(this.hooksDir, HOOK_SCRIPTS[0])}"`,
        hookId: HOOK_IDS[0],
      },
      {
        eventType: "PostToolUse",
        // [D19] No matcher — filtering happens inside hook script via allowlist
        command: `bun "${join(this.hooksDir, HOOK_SCRIPTS[1])}"`,
        hookId: HOOK_IDS[1],
        timeout: 10,
      },
      {
        eventType: "Stop",
        command: `bun "${join(this.hooksDir, HOOK_SCRIPTS[2])}"`,
        hookId: HOOK_IDS[2],
        timeout: 30,
      },
    ];
  }
}
