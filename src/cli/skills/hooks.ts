import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateAutoObserveHook } from "./hooks/auto-observe";
import { generateSessionStartHook } from "./hooks/session-start";
import { generateStopHook } from "./hooks/stop";

export interface HookConfig {
  eventType: string;
  command: string;
  hookId: string;
  matcher?: string;
  timeout?: number;
}

export const KAI_HOOK_IDS = [
  "kai-session-start",
  "kai-auto-observe",
  "kai-stop",
] as const;
export const KAI_HOOK_SCRIPTS = [
  "kai-session-start.cjs",
  "kai-auto-observe.cjs",
  "kai-stop.cjs",
] as const;

interface HookGroup {
  matcher?: string;
  hooks: Array<{
    type: string;
    command: string;
    timeout?: number;
    statusMessage?: string;
  }>;
}

interface SettingsJson {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export function isKaiHook(command: string): boolean {
  return KAI_HOOK_IDS.some((id) => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[/\\\\])${escaped}(?:\\.cjs)?(?:\\s|$|"|')`).test(
      command,
    );
  });
}

export function mergeHookIntoSettings(
  settings: SettingsJson,
  config: HookConfig,
): SettingsJson {
  const result = structuredClone(settings);
  if (!result.hooks) result.hooks = {};
  if (!result.hooks[config.eventType]) result.hooks[config.eventType] = [];

  const groups = result.hooks[config.eventType];

  for (const group of groups) {
    for (let i = 0; i < group.hooks.length; i++) {
      if (isKaiHook(group.hooks[i].command)) {
        group.hooks[i] = {
          type: "command",
          command: config.command,
          ...(config.timeout ? { timeout: config.timeout } : {}),
        };
        return result;
      }
    }
  }

  const newGroup: HookGroup = {
    ...(config.matcher ? { matcher: config.matcher } : {}),
    hooks: [
      {
        type: "command",
        command: config.command,
        ...(config.timeout ? { timeout: config.timeout } : {}),
      },
    ],
  };
  groups.push(newGroup);

  return result;
}

export function removeHookFromSettings(
  settings: SettingsJson,
  config: { eventType: string; hookId: string },
): SettingsJson {
  const result = structuredClone(settings);
  if (!result.hooks?.[config.eventType]) return result;

  const groups = result.hooks[config.eventType];
  for (const group of groups) {
    group.hooks = group.hooks.filter((h) => !isKaiHook(h.command));
  }
  result.hooks[config.eventType] = groups.filter((g) => g.hooks.length > 0);

  return result;
}

export function writeHookScripts(hooksDir: string, derivePath?: string): void {
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(
    join(hooksDir, KAI_HOOK_SCRIPTS[0]),
    generateSessionStartHook(),
  );
  writeFileSync(join(hooksDir, KAI_HOOK_SCRIPTS[1]), generateAutoObserveHook());
  writeFileSync(
    join(hooksDir, KAI_HOOK_SCRIPTS[2]),
    generateStopHook(derivePath),
  );
}

export function getHookConfigs(hooksDir: string): HookConfig[] {
  return [
    {
      eventType: "SessionStart",
      command: `bun "${join(hooksDir, KAI_HOOK_SCRIPTS[0])}"`,
      hookId: KAI_HOOK_IDS[0],
    },
    {
      eventType: "PostToolUse",
      // Matcher prevents spawning a process for every tool call; allowlist inside hook script handles finer filtering
      matcher:
        "Bash|Read|Edit|Write|MultiEdit|Grep|Glob|WebSearch|WebFetch|TodoRead|TodoWrite",
      command: `bun "${join(hooksDir, KAI_HOOK_SCRIPTS[1])}"`,
      hookId: KAI_HOOK_IDS[1],
      timeout: 10,
    },
    {
      eventType: "Stop",
      command: `bun "${join(hooksDir, KAI_HOOK_SCRIPTS[2])}"`,
      hookId: KAI_HOOK_IDS[2],
      timeout: 30,
    },
  ];
}
