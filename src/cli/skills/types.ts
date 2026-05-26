// src/cli/skills/types.ts

interface ToolMapping {
  toolId: string;
  schemaExportName: string;
  slashCommand: string;
  description: string;
}

export interface SkillConfig {
  domain: string;
  skillName: string;
  slashCommands: string[];
  tools: ToolMapping[];
  resources: string[];
}

export interface McpConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface SkillManifest {
  kaiVersion: string;
  generatedAt: string;
  skills: Record<string, string[]>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
