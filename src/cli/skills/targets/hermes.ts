// src/cli/skills/targets/hermes.ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
import {
  configureMcpInConfig,
  removeMcpFromConfig,
  validateMcpInConfig,
} from "../utils/mcp-config";
import { validateSkillManifest } from "../utils/validate";
import type { TargetAdapter } from "./types";

export class HermesTarget implements TargetAdapter {
  readonly name = "hermes";
  readonly skillInstallPath: string;
  private readonly configPath: string;

  constructor(skillInstallPath?: string, configPath?: string) {
    this.skillInstallPath =
      skillInstallPath ?? join(homedir(), ".hermes", "skills", "kai");
    this.configPath = configPath ?? join(homedir(), ".hermes", "config.yaml");
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
    return validateMcpInConfig({
      configPath: this.configPath,
      mcpServersKey: "mcp_servers",
      format: "yaml",
    });
  }

  async configureMcp(config: McpConfig, force = false): Promise<void> {
    await configureMcpInConfig(
      config,
      {
        configPath: this.configPath,
        mcpServersKey: "mcp_servers",
        format: "yaml",
      },
      force,
    );
  }

  async removeMcp(): Promise<void> {
    await removeMcpFromConfig({
      configPath: this.configPath,
      mcpServersKey: "mcp_servers",
      format: "yaml",
    });
  }
}
