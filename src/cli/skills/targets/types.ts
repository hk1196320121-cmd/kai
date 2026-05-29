import type {
  McpConfig,
  SkillFile,
  SkillManifest,
  TargetCapabilities,
  ValidationResult,
} from "../types";

export interface TargetAdapter {
  readonly name: string;
  readonly skillInstallPath: string;
  // Optional auxiliary paths for capability-gated doctor checks
  readonly commandsDir?: string;
  readonly hooksDir?: string;
  readonly settingsPath?: string;
  configureMcp(config: McpConfig, force?: boolean): Promise<void>;
  removeMcp(): Promise<void>;
  validateInstallation(): ValidationResult;
  capabilities(): TargetCapabilities;
  installSkills(skills: SkillFile[], manifest: SkillManifest): Promise<void>;
  removeSkills(): Promise<void>;
  // Validate MCP server registration in platform config
  validateMcp(): ValidationResult;
}
