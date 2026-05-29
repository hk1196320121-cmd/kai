import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  McpConfig,
  SkillFile,
  SkillManifest,
  TargetCapabilities,
  ValidationResult,
} from "../types";
import { atomicWriteJson } from "../utils/fs";
import { validateSkillManifest } from "../utils/validate";
import type { TargetAdapter } from "./types";

export class GeminiCliTarget implements TargetAdapter {
  readonly name = "gemini-cli";
  readonly skillInstallPath: string;
  readonly settingsPath: string;

  constructor(skillInstallPath?: string, settingsPath?: string) {
    this.skillInstallPath =
      skillInstallPath ?? join(homedir(), ".gemini", "skills", "kai");
    this.settingsPath =
      settingsPath ?? join(homedir(), ".gemini", "settings.json");
  }

  capabilities(): TargetCapabilities {
    return {
      skillMd: true,
      mcp: true,
      hooks: false,
      commands: false,
      terminal: true,
      skillDirectory: true,
    };
  }

  async installSkills(
    skills: SkillFile[],
    manifest: SkillManifest,
  ): Promise<void> {
    mkdirSync(this.skillInstallPath, { recursive: true });
    for (const skill of skills) {
      const filePath = join(this.skillInstallPath, skill.filename);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, skill.content);
    }
    atomicWriteJson(join(this.skillInstallPath, "manifest.json"), manifest);
  }

  async removeSkills(): Promise<void> {
    if (existsSync(this.skillInstallPath)) {
      rmSync(this.skillInstallPath, { recursive: true, force: true });
    }
  }

  validateInstallation(): ValidationResult {
    return validateSkillManifest(this.skillInstallPath, this.name);
  }

  validateMcp(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!existsSync(this.settingsPath)) {
      warnings.push(
        "No ~/.gemini/settings.json found. Run with --configure-mcp to register.",
      );
      return { valid: true, errors, warnings };
    }

    try {
      const resolved = realpathSync(this.settingsPath);
      const config = JSON.parse(readFileSync(resolved, "utf-8"));
      if (!config.mcpServers?.kai) {
        errors.push(
          'No "kai" MCP server registered in ~/.gemini/settings.json. Run with --configure-mcp.',
        );
      }
    } catch {
      errors.push("Cannot parse ~/.gemini/settings.json for MCP validation.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async configureMcp(config: McpConfig, force = false): Promise<void> {
    let existing: Record<string, unknown>;

    if (existsSync(this.settingsPath)) {
      try {
        const resolved = realpathSync(this.settingsPath);
        existing = JSON.parse(readFileSync(resolved, "utf-8"));
      } catch {
        throw new Error(
          `Cannot read ${this.settingsPath}. Check the file contains valid JSON.`,
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
          `Conflicting MCP entry for "kai" in ${this.settingsPath}. Use --force to overwrite, or edit manually.`,
        );
      }
      return;
    }

    servers.kai = config;
    atomicWriteJson(this.settingsPath, existing);
  }

  async removeMcp(): Promise<void> {
    if (!existsSync(this.settingsPath)) return;

    let existing: Record<string, unknown>;
    try {
      const resolved = realpathSync(this.settingsPath);
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
      atomicWriteJson(this.settingsPath, existing);
    }
  }
}
