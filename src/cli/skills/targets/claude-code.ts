import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { McpConfig, ValidationResult } from "../types";
import type { TargetAdapter } from "./types";

export class ClaudeCodeTarget implements TargetAdapter {
  readonly name = "claude-code";
  readonly skillInstallPath: string;
  readonly commandsDir: string;
  readonly hooksDir: string;
  private readonly claudeJsonPath: string;
  readonly settingsJsonPath: string;

  constructor(
    skillInstallPath?: string,
    claudeJsonPath?: string,
    settingsJsonPath?: string,
    commandsDir?: string,
    hooksDir?: string,
  ) {
    this.skillInstallPath =
      skillInstallPath ?? join(homedir(), ".claude", "skills", "kai");
    this.claudeJsonPath = claudeJsonPath ?? join(homedir(), ".claude.json");
    this.settingsJsonPath =
      settingsJsonPath ?? join(homedir(), ".claude", "settings.json");
    this.commandsDir =
      commandsDir ?? join(homedir(), ".claude", "commands", "kai");
    this.hooksDir = hooksDir ?? join(homedir(), ".claude", "hooks", "kai");
  }

  validateInstallation(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const manifestPath = join(this.skillInstallPath, "manifest.json");
    if (!existsSync(manifestPath)) {
      errors.push("No manifest.json found. Run `kai skills install` first.");
      return { valid: false, errors, warnings };
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      if (!manifest.kaiVersion) {
        errors.push("Manifest missing kaiVersion field.");
      }
      if (!manifest.skills || Object.keys(manifest.skills).length === 0) {
        warnings.push("Manifest has no skills registered.");
      }
    } catch {
      errors.push("Manifest file contains invalid JSON.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async configureMcp(config: McpConfig, force = false): Promise<void> {
    let existing: Record<string, unknown>;

    if (existsSync(this.claudeJsonPath)) {
      try {
        const resolved = realpathSync(this.claudeJsonPath);
        existing = JSON.parse(readFileSync(resolved, "utf-8"));
      } catch {
        throw new Error(
          `Cannot read ${this.claudeJsonPath}. Check the file contains valid JSON.`,
        );
      }
    } else {
      existing = {};
    }

    if (
      typeof existing.mcpServers !== "object" ||
      existing.mcpServers === null ||
      Array.isArray(existing.mcpServers)
    ) {
      existing.mcpServers = {};
    }

    const servers = existing.mcpServers as Record<string, unknown>;
    if (servers.kai && !force) {
      const existingEntry = servers.kai as McpConfig;
      if (
        existingEntry.command !== config.command ||
        JSON.stringify(existingEntry.args) !== JSON.stringify(config.args)
      ) {
        throw new Error(
          `Conflicting MCP entry for "kai" in ${this.claudeJsonPath}. Use --force to overwrite, or edit manually.`,
        );
      }
      return;
    }

    servers.kai = config;
    this.atomicWriteJson(this.claudeJsonPath, existing);
  }

  async removeMcp(): Promise<void> {
    if (!existsSync(this.claudeJsonPath)) return;

    let existing: Record<string, unknown>;
    try {
      const resolved = realpathSync(this.claudeJsonPath);
      existing = JSON.parse(readFileSync(resolved, "utf-8"));
    } catch {
      return;
    }

    if (
      typeof existing.mcpServers === "object" &&
      existing.mcpServers !== null &&
      !Array.isArray(existing.mcpServers) &&
      (existing.mcpServers as Record<string, unknown>).kai
    ) {
      delete (existing.mcpServers as Record<string, unknown>).kai;
      this.atomicWriteJson(this.claudeJsonPath, existing);
    }
  }

  async mergeSettingsHook(
    hookConfig: import("../hooks").HookConfig,
  ): Promise<void> {
    let settings: Record<string, unknown>;
    if (existsSync(this.settingsJsonPath)) {
      try {
        const resolved = realpathSync(this.settingsJsonPath);
        const raw = readFileSync(resolved, "utf-8");
        settings = JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `Cannot parse ${this.settingsJsonPath}: ${err instanceof Error ? err.message : String(err)}. ` +
            `Fix or remove the file manually, then re-run install.`,
        );
      }
    } else {
      settings = {};
    }

    const { mergeHookIntoSettings } = await import("../hooks");
    const merged = mergeHookIntoSettings(settings, hookConfig);
    this.atomicWriteJson(this.settingsJsonPath, merged);
  }

  async removeSettingsHooks(): Promise<void> {
    if (!existsSync(this.settingsJsonPath)) return;

    let settings: Record<string, unknown>;
    try {
      const resolved = realpathSync(this.settingsJsonPath);
      settings = JSON.parse(readFileSync(resolved, "utf-8"));
    } catch {
      return;
    }

    const { removeHookFromSettings, getHookConfigs } = await import("../hooks");
    const hookConfigs = getHookConfigs(this.hooksDir);
    let cleaned = settings;
    for (const hc of hookConfigs) {
      cleaned = removeHookFromSettings(cleaned, {
        eventType: hc.eventType,
        hookId: hc.hookId,
      });
    }
    this.atomicWriteJson(this.settingsJsonPath, cleaned);
  }

  private atomicWriteJson(filePath: string, data: unknown): void {
    const resolved = existsSync(filePath) ? realpathSync(filePath) : filePath;
    const dir = dirname(resolved);
    mkdirSync(dir, { recursive: true });
    const tmpPath = join(dir, `.kai-skills-${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, resolved);
  }
}
