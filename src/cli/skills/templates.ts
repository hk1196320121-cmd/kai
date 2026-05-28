// src/cli/skills/templates.ts
// Generate SKILL.md files (per-domain and master) from SkillConfig[].

import { DOMAIN_DESCRIPTIONS, describeParameters } from "./compiler";
import type { SkillConfig } from "./types";

/**
 * Domains whose slash commands overlap with workflow commands.
 * These use intent-based triggers instead of slash-command triggers.
 */
export const OVERLAPPING_DOMAINS = [
  "profile",
  "observe",
  "idea",
  "work",
  "prompt",
  "telemetry",
];

const INTENT_TRIGGERS: Record<string, string> = {
  profile:
    "questions about behavioral profile, trait values, profile summary, trait explanations",
  observe:
    "submitting observations, recording behavioral data, logging preferences or patterns",
  idea:
    "managing ideas, creating plans, approving tasks, executing work, orchestrating projects",
  work:
    "getting work recommendations, checking task status, finding what to work on next",
  prompt:
    "compiling prompts, evolving prompts, inspecting prompt variants, champion prompts",
  telemetry:
    "querying telemetry, tracing requests, explaining system behavior, performance data",
};

/**
 * Convert a tool ID like "profile.read" or "kai_work_recommend" into the
 * MCP tool name format used in allowed-tools: mcp__kai__profile_read
 */
export function mcpToolName(toolId: string): string {
  return toolId.replace(/\./g, "_");
}

/**
 * Generate a per-domain SKILL.md string from a single SkillConfig.
 */
export function generateSkillMarkdown(config: SkillConfig): string {
  const domainInfo = DOMAIN_DESCRIPTIONS[config.domain] ?? {
    title: `Kai ${config.domain}`,
    description: `Kai ${config.domain} tools.`,
    examples: [],
  };

  const commandList = config.slashCommands.join(", ");

  const triggerLine = OVERLAPPING_DOMAINS.includes(config.domain)
    ? INTENT_TRIGGERS[config.domain] ?? commandList
    : commandList;

  const allowedTools = [
    "Bash",
    "Read",
    ...config.tools.map((t) => `mcp__kai__${mcpToolName(t.toolId)}`),
  ];

  const toolsSection = config.tools
    .map((t) => {
      const params = describeParameters(t.toolId);
      return `#### ${t.slashCommand}\n\n${t.description}\n\n### Parameters\n\n${params}`;
    })
    .join("\n\n");

  const resourceSection =
    config.resources.length > 0
      ? `\n### MCP Resources\n\n${config.resources.map((r) => `- \`${r}\``).join("\n")}`
      : "";

  const examplesSection =
    domainInfo.examples.length > 0
      ? `\n## Examples\n\n${domainInfo.examples.map((e) => `- ${e}`).join("\n")}`
      : "";

  return `---
name: ${config.skillName}
description: |
  ${domainInfo.description}
  Triggers: ${triggerLine}
allowed-tools:
${allowedTools.map((t) => `  - ${t}`).join("\n")}
---

## ${domainInfo.title}

${domainInfo.description}

### When to use

Use this skill when the user types any of: ${commandList}.
The agent should parse the user's intent and call the appropriate MCP tool.

### Tools

${toolsSection}${resourceSection}${examplesSection}
`;
}

/**
 * Generate the master SKILL.md that aggregates all domains.
 */
export function generateMasterSkill(configs: SkillConfig[]): string {
  const domainEntries = configs
    .map((c) => {
      const info = DOMAIN_DESCRIPTIONS[c.domain];
      const commands = c.slashCommands.join(", ");
      return `### ${info?.title ?? c.domain}\n\n${info?.description ?? ""}\n\nCommands: ${commands}`;
    })
    .join("\n\n");

  const allCommands = configs.flatMap((c) => c.slashCommands).sort();

  return `---
name: kai
description: |
  Kai — AI Behavioral Profile Engine. Your behavioral operating system.
  Type /kai to see all available commands.
  Triggers: /kai
allowed-tools:
  - Bash
  - Read
---

## Kai Command Palette

Kai is your behavioral intelligence platform. It learns from your observations and provides personalized insights, task recommendations, and prompt evolution.

### Available Domains

${domainEntries}

### All Commands

${allCommands.map((c) => `- \`${c}\``).join("\n")}

### Quick Start

- \`/kai-profile\` — see your behavioral profile
- \`/kai-work\` — get personalized task recommendations
- \`/kai-idea "your idea"\` — submit an idea for planning
`;
}
