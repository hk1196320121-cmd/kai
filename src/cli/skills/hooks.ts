import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateAutoObserveHook } from "./hooks/auto-observe";
import { generateSessionStartHook } from "./hooks/session-start";

export interface HookConfig {
  eventType: string;
  command: string;
  hookId: string;
  matcher?: string;
  timeout?: number;
}

export const KAI_HOOK_IDS = ["kai-session-start", "kai-auto-observe"] as const;
export const KAI_HOOK_SCRIPTS = [
  "kai-session-start.cjs",
  "kai-auto-observe.cjs",
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

export function writeHookScripts(hooksDir: string): void {
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(
    join(hooksDir, KAI_HOOK_SCRIPTS[0]),
    generateSessionStartHook(),
  );
  writeFileSync(join(hooksDir, KAI_HOOK_SCRIPTS[1]), generateAutoObserveHook());
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
      matcher: "Bash|Read|Edit|Write",
      command: `bun "${join(hooksDir, KAI_HOOK_SCRIPTS[1])}"`,
      hookId: KAI_HOOK_IDS[1],
      timeout: 10,
    },
  ];
}
