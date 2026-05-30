export type { AutopilotSession, HookInput, NudgeTemplate } from "./types";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type HookConfig,
  mergeHookIntoSettings,
  removeHookFromSettings,
} from "../cli/skills/hooks";
import { generateAutoObserveHook } from "../cli/skills/hooks/auto-observe";
import { generateSessionStartHook } from "../cli/skills/hooks/session-start";
import { generateStopHook } from "../cli/skills/hooks/stop";
import type { AutopilotSession } from "./types";

const HOOK_SCRIPTS = [
  "kai-session-start.cjs",
  "kai-auto-observe.cjs",
  "kai-stop.cjs",
] as const;

const HOOK_IDS = ["kai-session-start", "kai-auto-observe", "kai-stop"] as const;

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

    // [D7/D17] Resolve derive-shared path at install time and embed in Stop hook.
    // Bun natively require()'s TypeScript, so no transpile/bundle needed.
    let derivePath: string | undefined;
    try {
      derivePath = require.resolve("./derive-shared");
      if (!existsSync(derivePath)) derivePath = undefined;
    } catch {
      // derive-shared not found — Stop hook will skip derivation
    }
    writeFileSync(
      join(this.hooksDir, HOOK_SCRIPTS[2]),
      generateStopHook(derivePath),
    );

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

    try {
      // Pre-v9 compat: check if autopilot_sessions table exists before querying
      const tableExists = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_sessions'",
        )
        .get();
      if (!tableExists) {
        db.close();
        return { sessions: [], activeSession: null };
      }

      const sessions = db
        .query(
          "SELECT * FROM autopilot_sessions ORDER BY started_at DESC LIMIT 10",
        )
        .all() as AutopilotSession[];

      const activeSession = sessions.find((s) => s.stopped_at === null) ?? null;

      db.close();
      return { sessions, activeSession };
    } catch {
      db.close();
      return { sessions: [], activeSession: null };
    }
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
        // Matcher prevents spawning a process for every tool call; allowlist inside hook script handles finer filtering
        matcher:
          "Bash|Read|Edit|Write|MultiEdit|Grep|Glob|WebSearch|WebFetch|TodoRead|TodoWrite",
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
