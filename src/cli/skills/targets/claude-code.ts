// src/cli/skills/targets/claude-code.ts
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
import {
  configureMcpInConfig,
  removeMcpFromConfig,
  validateMcpInConfig,
} from "../utils/mcp-config";
import { validateSkillManifest } from "../utils/validate";
import type { TargetAdapter } from "./types";

export class ClaudeCodeTarget implements TargetAdapter {
  readonly name = "claude-code";
  readonly skillInstallPath: string;
  readonly commandsDir: string;
  readonly hooksDir: string;
  private readonly claudeJsonPath: string;
  readonly settingsPath: string;

  constructor(
    skillInstallPath?: string,
    claudeJsonPath?: string,
    settingsPath?: string,
    commandsDir?: string,
    hooksDir?: string,
  ) {
    this.skillInstallPath =
      skillInstallPath ?? join(homedir(), ".claude", "skills", "kai");
    this.claudeJsonPath = claudeJsonPath ?? join(homedir(), ".claude.json");
    this.settingsPath =
      settingsPath ?? join(homedir(), ".claude", "settings.json");
    this.commandsDir =
      commandsDir ?? join(homedir(), ".claude", "commands", "kai");
    this.hooksDir = hooksDir ?? join(homedir(), ".claude", "hooks", "kai");
  }

  capabilities(): TargetCapabilities {
    return {
      skillMd: true,
      mcp: true,
      hooks: true,
      commands: true,
      terminal: true,
      skillDirectory: true,
    };
  }

  async installSkills(
    skills: SkillFile[],
    manifest: SkillManifest,
  ): Promise<void> {
    // Write skill files
    mkdirSync(this.skillInstallPath, { recursive: true });
    for (const skill of skills) {
      const filePath = join(this.skillInstallPath, skill.filename);
      const dir = dirname(filePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, skill.content);
    }

    // Write manifest
    atomicWriteJson(join(this.skillInstallPath, "manifest.json"), manifest);

    // Write workflow commands
    const { WORKFLOWS } = await import("../workflows/definitions");
    const { CommandGenerator } = await import("../workflows/generator");
    const { getBakedTraits } = await import("../commands/profile-aware");

    mkdirSync(this.commandsDir, { recursive: true });

    let bakedTraits: Map<string, number>;
    try {
      const { getEngine } = await import("../../utils");
      const { db, engine } = getEngine();
      const snapshot = engine.getProfile();
      bakedTraits = getBakedTraits(snapshot);
      db.close();
    } catch {
      bakedTraits = new Map();
    }

    const gen = new CommandGenerator(bakedTraits);
    const commands = gen.generateAll(WORKFLOWS);
    for (const cmd of commands) {
      writeFileSync(join(this.commandsDir, `${cmd.name}.md`), cmd.content);
    }

    // Write hook scripts and register in settings.json
    const { writeHookScripts, getHookConfigs } = await import("../hooks");
    writeHookScripts(this.hooksDir);
    const hookConfigs = getHookConfigs(this.hooksDir);
    for (const hc of hookConfigs) {
      await this.mergeSettingsHook(hc);
    }
  }

  async removeSkills(): Promise<void> {
    // Remove command files
    if (existsSync(this.commandsDir)) {
      rmSync(this.commandsDir, { recursive: true, force: true });
    }

    // Remove hook scripts
    if (existsSync(this.hooksDir)) {
      rmSync(this.hooksDir, { recursive: true, force: true });
    }

    // Remove hook registrations from settings.json
    await this.removeSettingsHooks();

    // Remove skill files
    if (existsSync(this.skillInstallPath)) {
      rmSync(this.skillInstallPath, { recursive: true, force: true });
    }
  }

  validateInstallation(): ValidationResult {
    return validateSkillManifest(this.skillInstallPath, this.name);
  }

  validateMcp(): ValidationResult {
    return validateMcpInConfig({
      configPath: this.claudeJsonPath,
      mcpServersKey: "mcpServers",
      format: "json",
    });
  }

  async configureMcp(config: McpConfig, force = false): Promise<void> {
    await configureMcpInConfig(
      config,
      {
        configPath: this.claudeJsonPath,
        mcpServersKey: "mcpServers",
        format: "json",
      },
      force,
    );
  }

  async removeMcp(): Promise<void> {
    await removeMcpFromConfig({
      configPath: this.claudeJsonPath,
      mcpServersKey: "mcpServers",
      format: "json",
    });
  }

  async mergeSettingsHook(
    hookConfig: import("../hooks").HookConfig,
  ): Promise<void> {
    let settings: Record<string, unknown>;
    if (existsSync(this.settingsPath)) {
      try {
        const resolved = realpathSync(this.settingsPath);
        const raw = readFileSync(resolved, "utf-8");
        settings = JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `Cannot parse ${this.settingsPath}: ${err instanceof Error ? err.message : String(err)}. ` +
            `Fix or remove the file manually, then re-run install.`,
        );
      }
    } else {
      settings = {};
    }

    const { mergeHookIntoSettings } = await import("../hooks");
    const merged = mergeHookIntoSettings(settings, hookConfig);
    atomicWriteJson(this.settingsPath, merged);
  }

  async removeSettingsHooks(): Promise<void> {
    if (!existsSync(this.settingsPath)) return;

    let settings: Record<string, unknown>;
    try {
      const resolved = realpathSync(this.settingsPath);
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
    atomicWriteJson(this.settingsPath, cleaned);
  }
}
