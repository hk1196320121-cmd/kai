import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeTarget } from "./claude-code";
import { GeminiCliTarget } from "./gemini-cli";
import { HermesTarget } from "./hermes";
import type { TargetAdapter } from "./types";

type AdapterFactory = () => TargetAdapter;

const TARGET_REGISTRY: Record<string, AdapterFactory> = {
  "claude-code": () => new ClaudeCodeTarget(),
  hermes: () => new HermesTarget(),
  "gemini-cli": () => new GeminiCliTarget(),
};

const PLATFORM_HOME_PATHS: Record<string, () => string> = {
  "claude-code": () => join(homedir(), ".claude"),
  hermes: () => join(homedir(), ".hermes"),
  "gemini-cli": () => join(homedir(), ".gemini"),
};

// Marker files that prove the platform is actually installed (not just a stale directory)
const PLATFORM_MARKERS: Record<string, string> = {
  "claude-code": "settings.json",
  hermes: "config.yaml",
  "gemini-cli": "settings.json",
};

const VALID_NAME_RE = /^[a-z][a-z0-9-]*$/;

export function getTargetNames(): string[] {
  return Object.keys(TARGET_REGISTRY);
}

export function getTarget(name: string): TargetAdapter {
  const factory = TARGET_REGISTRY[name];
  if (!factory) {
    const valid = Object.keys(TARGET_REGISTRY).join(", ");
    throw new Error(
      `Target "${name}" is not registered. Available targets: ${valid}`,
    );
  }
  return factory();
}

export function validateTargetName(name: string): void {
  if (!name) {
    throw new Error("Target name is required.");
  }
  if (!VALID_NAME_RE.test(name)) {
    throw new Error(
      `Invalid target name "${name}". Use lowercase letters, digits, and hyphens only.`,
    );
  }
  if (!(name in TARGET_REGISTRY)) {
    const valid = Object.keys(TARGET_REGISTRY).join(", ");
    throw new Error(
      `Target "${name}" is not registered. Available targets: ${valid}`,
    );
  }
}

export function detectPlatforms(
  overrides?: Record<string, () => boolean>,
): string[] {
  const result: string[] = [];
  for (const name of Object.keys(PLATFORM_HOME_PATHS)) {
    const detector =
      overrides?.[name] ??
      (() => {
        const homePath = PLATFORM_HOME_PATHS[name]();
        const marker = PLATFORM_MARKERS[name];
        return (
          existsSync(homePath) &&
          (marker
            ? existsSync(join(homePath, marker))
            : readdirSync(homePath).length > 0)
        );
      });
    if (detector()) {
      result.push(name);
    }
  }
  return result;
}
