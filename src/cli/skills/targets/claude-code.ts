import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpConfig, ValidationResult } from "../types";
import type { TargetAdapter } from "./types";

export class ClaudeCodeTarget implements TargetAdapter {
  readonly name = "claude-code";
  readonly skillInstallPath: string;
  private readonly claudeJsonPath: string;

  constructor(skillInstallPath?: string, claudeJsonPath?: string) {
    this.skillInstallPath =
      skillInstallPath ?? join(homedir(), ".claude", "skills", "kai");
    this.claudeJsonPath = claudeJsonPath ?? join(homedir(), ".claude.json");
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
    let existing: Record<string, unknown> = { mcpServers: {} };

    if (existsSync(this.claudeJsonPath)) {
      try {
        const resolved = realpathSync(this.claudeJsonPath);
        existing = JSON.parse(readFileSync(resolved, "utf-8"));
      } catch {
        throw new Error(
          `Cannot read ${this.claudeJsonPath}. Check the file contains valid JSON.`,
        );
      }
    }

    if (!existing.mcpServers) existing.mcpServers = {};

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

    try {
      const resolved = realpathSync(this.claudeJsonPath);
      const existing = JSON.parse(readFileSync(resolved, "utf-8"));
      if (existing.mcpServers?.kai) {
        delete existing.mcpServers.kai;
        this.atomicWriteJson(this.claudeJsonPath, existing);
      }
    } catch {
      // File doesn't exist or invalid — nothing to remove
    }
  }

  private atomicWriteJson(filePath: string, data: unknown): void {
    const dir = join(filePath, "..");
    mkdirSync(dir, { recursive: true });
    const tmpPath = join(dir, `.kai-skills-${Date.now()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    renameSync(tmpPath, filePath);
  }
}
