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
    return validateMcpInConfig({
      configPath: this.settingsPath,
      mcpServersKey: "mcpServers",
      format: "json",
    });
  }

  async configureMcp(config: McpConfig, force = false): Promise<void> {
    await configureMcpInConfig(
      config,
      {
        configPath: this.settingsPath,
        mcpServersKey: "mcpServers",
        format: "json",
      },
      force,
    );
  }

  async removeMcp(): Promise<void> {
    await removeMcpFromConfig({
      configPath: this.settingsPath,
      mcpServersKey: "mcpServers",
      format: "json",
    });
  }
}
