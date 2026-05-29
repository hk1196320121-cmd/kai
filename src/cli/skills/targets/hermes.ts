// src/cli/skills/targets/hermes.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse as yamlParse } from "yaml";
import type {
  McpConfig,
  SkillFile,
  SkillManifest,
  TargetCapabilities,
  ValidationResult,
} from "../types";
import type { TargetAdapter } from "./types";
import { atomicWriteJson, atomicWriteYaml } from "../utils/fs";
import { validateSkillManifest } from "../utils/validate";

export class HermesTarget implements TargetAdapter {
  readonly name = "hermes";
  readonly skillInstallPath: string;
  private readonly configPath: string;

  constructor(
    skillInstallPath?: string,
    configPath?: string,
  ) {
    this.skillInstallPath =
      skillInstallPath ?? join(homedir(), ".hermes", "skills", "kai");
    this.configPath =
      configPath ?? join(homedir(), ".hermes", "config.yaml");
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

  async installSkills(skills: SkillFile[], manifest: SkillManifest): Promise<void> {
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

    if (!existsSync(this.configPath)) {
      warnings.push("No ~/.hermes/config.yaml found. Run with --configure-mcp to register.");
      return { valid: true, errors, warnings };
    }

    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const config = yamlParse(raw) as Record<string, unknown> | null;
      const servers = config?.mcp_servers as Record<string, unknown> | undefined;
      if (!servers?.kai) {
        errors.push('No "kai" MCP server registered in ~/.hermes/config.yaml. Run with --configure-mcp.');
      }
    } catch {
      errors.push("Cannot parse ~/.hermes/config.yaml for MCP validation.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async configureMcp(config: McpConfig, force = false): Promise<void> {
    let existing: Record<string, unknown> = {};

    if (existsSync(this.configPath)) {
      try {
        existing = yamlParse(readFileSync(this.configPath, "utf-8")) as Record<string, unknown> ?? {};
      } catch {
        throw new Error(
          `Cannot read ${this.configPath}. Check the file contains valid YAML.`,
        );
      }
    }

    if (
      typeof existing.mcp_servers !== "object" ||
      existing.mcp_servers === null
    ) {
      existing.mcp_servers = {};
    }

    const servers = existing.mcp_servers as Record<string, unknown>;
    if (servers.kai && !force) {
      const existingEntry = servers.kai as Record<string, unknown>;
      if (
        existingEntry.command !== config.command ||
        JSON.stringify(existingEntry.args) !== JSON.stringify(config.args)
      ) {
        throw new Error(
          `Conflicting MCP entry for "kai" in ${this.configPath}. Use --force to overwrite, or edit manually.`,
        );
      }
      return;
    }

    servers.kai = config;
    atomicWriteYaml(this.configPath, existing);
  }

  async removeMcp(): Promise<void> {
    if (!existsSync(this.configPath)) return;

    let existing: Record<string, unknown>;
    try {
      existing = yamlParse(readFileSync(this.configPath, "utf-8")) as Record<string, unknown>;
    } catch {
      return;
    }

    if (
      typeof existing?.mcp_servers === "object" &&
      existing.mcp_servers !== null &&
      (existing.mcp_servers as Record<string, unknown>).kai
    ) {
      delete (existing.mcp_servers as Record<string, unknown>).kai;
      atomicWriteYaml(this.configPath, existing);
    }
  }
}
