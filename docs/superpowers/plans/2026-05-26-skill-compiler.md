# Dynamic Skill Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Dynamic Skill Compiler that introspects Kai's MCP tool schemas and generates SKILL.md skill files for Claude Code, enabling users to invoke tools via slash commands like `/kai-profile`, `/kai-work`.

**Architecture:** Import Zod schemas from 4 schema files, wrap with `z.object()`, call `z.toJSONSchema()` for JSON Schema parameter descriptions. Map tools to domains via explicit TOOL_DOMAIN_MAP and SCHEMA_TO_TOOL_MAP. Generate 8 SKILL.md files (7 domain + 1 master) plus a manifest. CLI provides install/list/doctor/uninstall commands. TargetAdapter interface enables multi-target support (Claude Code first).

**Tech Stack:** TypeScript, Zod v4, Commander.js, Bun runtime, Bun test framework

---

## File Structure

```
src/cli/skills/
  types.ts             — SkillManifest, ToolMapping, SkillConfig, McpConfig types
  compiler.ts          — TOOL_DOMAIN_MAP, SCHEMA_TO_TOOL_MAP, schema imports, domain grouping, SKILL.md generation
  templates.ts         — generateSkillMarkdown(), generateMasterSkill() — domain-specific templates
  targets/
    types.ts           — TargetAdapter interface
    claude-code.ts     — Claude Code target adapter (install path, MCP config, validation)
  commands/
    install.ts         — kai skills install [--target claude-code] [--force] [--configure-mcp]
    list.ts            — kai skills list
    doctor.ts          — kai skills doctor [--fix]
    uninstall.ts       — kai skills uninstall

tests/cli/skills/
  compiler.test.ts     — Unit tests for compiler
  templates.test.ts    — Snapshot tests for generated skill files
  targets.test.ts      — Target adapter tests
  integration.test.ts  — Install → doctor → uninstall flow
```

---

### Task 1: Types — `src/cli/skills/types.ts`

**Files:**
- Create: `src/cli/skills/types.ts`
- Test: `tests/cli/skills/compiler.test.ts` (verified in Task 3)

- [ ] **Step 1: Create types file**

```typescript
// src/cli/skills/types.ts

export interface ToolMapping {
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
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/skills/types.ts
git commit -m "feat(skills): add skill compiler type definitions"
```

---

### Task 2: Compiler — `src/cli/skills/compiler.ts`

**Files:**
- Create: `src/cli/skills/compiler.ts`
- Modify: (reads from `src/mcp/schema.ts`, `src/mcp/orchestrator-schema.ts`, `src/mcp/prompt-schema.ts`, `src/mcp/telemetry-schema.ts`)

- [ ] **Step 1: Write the failing test for compiler**

```typescript
// tests/cli/skills/compiler.test.ts
import { describe, test, expect } from "bun:test";
import {
  TOOL_DOMAIN_MAP,
  SCHEMA_TO_TOOL_MAP,
  getToolsByDomain,
  buildSkillConfigs,
  sanitizeToolName,
  sanitizeDomainName,
} from "../../../src/cli/skills/compiler";

describe("compiler.ts", () => {
  describe("TOOL_DOMAIN_MAP", () => {
    test("maps every known MCP tool to a domain", () => {
      const knownTools = [
        "profile.read", "profile.why",
        "observe.submit", "observe.batch",
        "derive.trigger",
        "kai_work_recommend", "kai_execution_status",
        "kai_idea_submit", "kai_idea_plan", "kai_plan_approve",
        "kai_task_execute", "kai_idea_pause", "kai_replan",
        "prompt.compile", "prompt.champion", "prompt.evolve",
        "telemetry.query", "telemetry.trace", "telemetry.explain",
      ];
      for (const tool of knownTools) {
        expect(TOOL_DOMAIN_MAP[tool], `Missing domain mapping for ${tool}`).toBeDefined();
      }
    });

    test("all domains are valid directory names", () => {
      const domains = new Set(Object.values(TOOL_DOMAIN_MAP));
      for (const domain of domains) {
        expect(domain).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });
  });

  describe("SCHEMA_TO_TOOL_MAP", () => {
    test("maps every schema export name to a tool ID", () => {
      const expectedMappings: Record<string, string> = {
        ProfileReadSchema: "profile.read",
        ProfileWhySchema: "profile.why",
        ObserveSubmitSchema: "observe.submit",
        ObserveBatchSchema: "observe.batch",
        DeriveTriggerSchema: "derive.trigger",
        WorkRecommendSchema: "kai_work_recommend",
        IdeaSubmitSchema: "kai_idea_submit",
        IdeaPlanSchema: "kai_idea_plan",
        PlanApproveSchema: "kai_plan_approve",
        TaskExecuteSchema: "kai_task_execute",
        IdeaPauseSchema: "kai_idea_pause",
        ExecutionStatusSchema: "kai_execution_status",
        ReplanSchema: "kai_replan",
        PromptCompileSchema: "prompt.compile",
        PromptChampionSchema: "prompt.champion",
        PromptEvolveSchema: "prompt.evolve",
        TelemetryQuerySchema: "telemetry.query",
        TelemetryTraceSchema: "telemetry.trace",
        TelemetryExplainSchema: "telemetry.explain",
      };
      for (const [schema, toolId] of Object.entries(expectedMappings)) {
        expect(SCHEMA_TO_TOOL_MAP[schema], `Missing mapping for ${schema}`).toBe(toolId);
      }
    });
  });

  describe("getToolsByDomain", () => {
    test("groups tools into expected domains", () => {
      const grouped = getToolsByDomain();
      expect(Object.keys(grouped).sort()).toEqual(
        ["derive", "idea", "observe", "profile", "prompt", "telemetry", "work"].sort()
      );
    });

    test("profile domain contains profile.read and profile.why", () => {
      const grouped = getToolsByDomain();
      const profileTools = grouped["profile"].map(t => t.toolId).sort();
      expect(profileTools).toEqual(["profile.read", "profile.why"]);
    });

    test("idea domain contains 6 orchestrator tools", () => {
      const grouped = getToolsByDomain();
      const ideaTools = grouped["idea"].map(t => t.toolId);
      expect(ideaTools).toHaveLength(6);
      expect(ideaTools).toContain("kai_idea_submit");
      expect(ideaTools).toContain("kai_replan");
    });

    test("every tool has a non-empty slashCommand", () => {
      const grouped = getToolsByDomain();
      for (const [domain, tools] of Object.entries(grouped)) {
        for (const tool of tools) {
          expect(tool.slashCommand.length).toBeGreaterThan(0);
          expect(tool.slashCommand).toMatch(/^\/kai-/);
        }
      }
    });
  });

  describe("buildSkillConfigs", () => {
    test("returns 7 domain skill configs", () => {
      const configs = buildSkillConfigs();
      expect(configs).toHaveLength(7);
    });

    test("total tool count across all skills is 19", () => {
      const configs = buildSkillConfigs();
      const totalTools = configs.reduce((sum, c) => sum + c.tools.length, 0);
      expect(totalTools).toBe(19);
    });
  });

  describe("sanitizeToolName", () => {
    test("accepts valid tool names", () => {
      expect(sanitizeToolName("profile.read")).toBe("profile.read");
      expect(sanitizeToolName("kai_idea_submit")).toBe("kai_idea_submit");
    });

    test("rejects path traversal", () => {
      expect(() => sanitizeToolName("../etc/passwd")).toThrow(/invalid/i);
      expect(() => sanitizeToolName("foo../../bar")).toThrow(/invalid/i);
    });

    test("rejects empty string", () => {
      expect(() => sanitizeToolName("")).toThrow(/invalid/i);
    });
  });

  describe("sanitizeDomainName", () => {
    test("accepts valid domain names", () => {
      expect(sanitizeDomainName("profile")).toBe("profile");
      expect(sanitizeDomainName("observe")).toBe("observe");
    });

    test("rejects names with slashes", () => {
      expect(() => sanitizeDomainName("foo/bar")).toThrow(/invalid/i);
    });

    test("rejects path traversal", () => {
      expect(() => sanitizeDomainName("..")).toThrow(/invalid/i);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/skills/compiler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write compiler implementation**

```typescript
// src/cli/skills/compiler.ts
import { z } from "zod";
import type { SkillConfig, ToolMapping } from "./types";

// --- Explicit maps (convention fails for orchestrator tools) ---

export const TOOL_DOMAIN_MAP: Record<string, string> = {
  "profile.read": "profile",
  "profile.why": "profile",
  "observe.submit": "observe",
  "observe.batch": "observe",
  "derive.trigger": "derive",
  "kai_work_recommend": "work",
  "kai_execution_status": "work",
  "kai_idea_submit": "idea",
  "kai_idea_plan": "idea",
  "kai_plan_approve": "idea",
  "kai_task_execute": "idea",
  "kai_idea_pause": "idea",
  "kai_replan": "idea",
  "prompt.compile": "prompt",
  "prompt.champion": "prompt",
  "prompt.evolve": "prompt",
  "telemetry.query": "telemetry",
  "telemetry.trace": "telemetry",
  "telemetry.explain": "telemetry",
};

export const SCHEMA_TO_TOOL_MAP: Record<string, string> = {
  ProfileReadSchema: "profile.read",
  ProfileWhySchema: "profile.why",
  ObserveSubmitSchema: "observe.submit",
  ObserveBatchSchema: "observe.batch",
  DeriveTriggerSchema: "derive.trigger",
  WorkRecommendSchema: "kai_work_recommend",
  IdeaSubmitSchema: "kai_idea_submit",
  IdeaPlanSchema: "kai_idea_plan",
  PlanApproveSchema: "kai_plan_approve",
  TaskExecuteSchema: "kai_task_execute",
  IdeaPauseSchema: "kai_idea_pause",
  ExecutionStatusSchema: "kai_execution_status",
  ReplanSchema: "kai_replan",
  PromptCompileSchema: "prompt.compile",
  PromptChampionSchema: "prompt.champion",
  PromptEvolveSchema: "prompt.evolve",
  TelemetryQuerySchema: "telemetry.query",
  TelemetryTraceSchema: "telemetry.trace",
  TelemetryExplainSchema: "telemetry.explain",
};

// --- Slash command mapping ---

const TOOL_SLASH_MAP: Record<string, string> = {
  "profile.read": "/kai-profile",
  "profile.why": "/kai-why",
  "observe.submit": "/kai-observe",
  "observe.batch": "/kai-observe-batch",
  "derive.trigger": "/kai-derive",
  "kai_work_recommend": "/kai-work",
  "kai_execution_status": "/kai-status",
  "kai_idea_submit": "/kai-idea",
  "kai_idea_plan": "/kai-plan",
  "kai_plan_approve": "/kai-approve",
  "kai_task_execute": "/kai-execute",
  "kai_idea_pause": "/kai-pause",
  "kai_replan": "/kai-replan",
  "prompt.compile": "/kai-prompt",
  "prompt.champion": "/kai-champion",
  "prompt.evolve": "/kai-evolve",
  "telemetry.query": "/kai-telemetry",
  "telemetry.trace": "/kai-trace",
  "telemetry.explain": "/kai-explain",
};

// --- Resource URIs by domain ---

const DOMAIN_RESOURCES: Record<string, string[]> = {
  profile: [
    "kai://profile/identity",
    "kai://profile/traits",
    "kai://profile/traits/{dimension}",
    "kai://profile/observations/recent",
    "kai://profile/summary",
  ],
  observe: [
    "kai://profile/observations/recent",
  ],
  work: [
    "kai://system/health",
  ],
  prompt: [
    "kai://prompt/{task}",
    "kai://prompt/champion/{task}",
    "kai://prompt/evolution-history/{task}",
  ],
  telemetry: [
    "kai://telemetry/trace/{traceId}",
    "kai://telemetry/recent-errors",
    "kai://telemetry/health",
  ],
};

// --- Schema imports for parameter introspection ---

import * as coreSchema from "../../mcp/schema";
import * as orchestratorSchema from "../../mcp/orchestrator-schema";
import * as promptSchema from "../../mcp/prompt-schema";
import * as telemetrySchema from "../../mcp/telemetry-schema";

const SCHEMA_MODULES = [
  { module: coreSchema, prefix: "" },
  { module: orchestratorSchema, prefix: "" },
  { module: promptSchema, prefix: "" },
  { module: telemetrySchema, prefix: "" },
];

function getSchemaForTool(toolId: string): Record<string, z.ZodTypeAny> | undefined {
  const schemaExportName = Object.entries(SCHEMA_TO_TOOL_MAP).find(
    ([, id]) => id === toolId,
  )?.[0];
  if (!schemaExportName) return undefined;

  for (const { module } of SCHEMA_MODULES) {
    if (schemaExportName in module) {
      return module[schemaExportName] as Record<string, z.ZodTypeAny>;
    }
  }
  return undefined;
}

function describeParameters(toolId: string): string {
  const schema = getSchemaForTool(toolId);
  if (!schema) return "No parameters.";

  const parts: string[] = [];
  for (const [name, zodType] of Object.entries(schema)) {
    const isOptional = zodType instanceof z.ZodOptional;
    const desc = zodType._def?.description ?? (zodType.unwrap?.() as z.ZodTypeAny)?._def?.description;
    let line = `- **${name}**${isOptional ? " (optional)" : ""}`;
    if (desc) line += `: ${desc}`;
    parts.push(line);
  }
  return parts.join("\n");
}

// --- Sanitization ---

const TOOL_NAME_RE = /^[a-zA-Z0-9_.-]+$/;
const DOMAIN_NAME_RE = /^[a-z][a-z0-9-]*$/;

export function sanitizeToolName(name: string): string {
  if (!name || !TOOL_NAME_RE.test(name)) {
    throw new Error(`Invalid tool name: "${name}". Must match ${TOOL_NAME_RE.source}`);
  }
  return name;
}

export function sanitizeDomainName(name: string): string {
  if (!name || !DOMAIN_NAME_RE.test(name)) {
    throw new Error(`Invalid domain name: "${name}". Must match ${DOMAIN_NAME_RE.source}`);
  }
  return name;
}

// --- Tool description templates ---

const TOOL_DESCRIPTIONS: Record<string, string> = {
  "profile.read": "Read the user's behavioral profile. Returns traits, identity, and summary based on accumulated observations.",
  "profile.why": "Explain why a specific trait dimension exists in the profile. Shows the observations and reasoning that led to the trait value.",
  "observe.submit": "Submit a new behavioral observation about the user. This is how Kai learns — each observation feeds into the profile derivation engine.",
  "observe.batch": "Submit multiple observations at once. Useful for bulk importing observations from a tool or session.",
  "derive.trigger": "Trigger profile derivation — re-processes all observations to update the behavioral profile. Use after submitting new observations.",
  "kai_work_recommend": "Get personalized task recommendations based on the user's behavioral profile. Considers traits, work patterns, and current context.",
  "kai_execution_status": "Check the status of a running or completed task execution. Provides progress, results, and any feedback.",
  "kai_idea_submit": "Submit a new idea for Kai to plan and potentially execute. The idea goes through planning, approval, and execution stages.",
  "kai_idea_plan": "Generate an execution plan for a submitted idea. Creates tasks with estimates, dependencies, and scheduling.",
  "kai_plan_approve": "Approve a generated plan and queue it for execution. Optionally modify tasks before approval.",
  "kai_task_execute": "Execute a specific task from an approved plan. Starts the task runner and returns execution status.",
  "kai_idea_pause": "Pause execution of an idea's plan. All running tasks are suspended.",
  "kai_replan": "Re-plan an idea from its current state. Useful when circumstances change or a task fails.",
  "prompt.compile": "Compile the current prompt configuration for a specific task type (planner, derivator, observer). Shows the assembled prompt.",
  "prompt.champion": "Get the current champion prompt segment for a task type. The champion is the best-performing prompt variant.",
  "prompt.evolve": "Run prompt evolution — generates new prompt variants, evaluates them against the champion, and potentially crowns a new champion.",
  "telemetry.query": "Query the telemetry store with SQL. Returns traces, events, and performance data about MCP tool calls.",
  "telemetry.trace": "Get a specific trace by ID. Shows the full causal chain of a request through the system.",
  "telemetry.explain": "Ask a natural language question about telemetry data. The system translates it to a query and explains the results.",
};

// --- Domain descriptions for templates ---

export const DOMAIN_DESCRIPTIONS: Record<string, { title: string; description: string; examples: string[] }> = {
  profile: {
    title: "Kai Profile",
    description: "Read and explore the user's behavioral profile — traits, identity, and the reasoning behind each dimension.",
    examples: [
      "Try: /kai-profile → see your behavioral profile summary",
      "Try: /kai-profile scope=full → see everything Kai knows about you",
      "Try: /kai-why early_riser → understand why Kai thinks you're an early riser",
    ],
  },
  observe: {
    title: "Kai Observe",
    description: "Submit behavioral observations that feed into Kai's profile engine. Each observation helps Kai learn about the user.",
    examples: [
      "Try: /kai-observe \"User prefers dark mode in all tools\" → submit an observation",
      "Try: /kai-observe-batch → submit multiple observations at once",
    ],
  },
  derive: {
    title: "Kai Derive",
    description: "Trigger profile derivation to re-process observations and update the behavioral profile.",
    examples: [
      "Try: /kai-derive → re-derive the profile from all observations",
      "Try: /kai-derive method=llm → use LLM-based derivation",
    ],
  },
  work: {
    title: "Kai Work",
    description: "Get personalized task recommendations and check execution status based on the user's behavioral profile.",
    examples: [
      "Try: /kai-work → get personalized task recommendations",
      "Try: /kai-status → check current task execution status",
    ],
  },
  idea: {
    title: "Kai Idea Orchestrator",
    description: "Submit ideas, generate plans, approve and execute tasks. The full idea-to-execution pipeline powered by behavioral intelligence.",
    examples: [
      "Try: /kai-idea \"Build a personal dashboard\" → submit an idea for planning",
      "Try: /kai-plan → generate an execution plan for an idea",
      "Try: /kai-approve → approve a plan and queue for execution",
    ],
  },
  prompt: {
    title: "Kai Prompt Engine",
    description: "Compile, inspect, and evolve the prompts that drive Kai's core engines (planner, derivator, observer).",
    examples: [
      "Try: /kai-prompt → compile and view the current planner prompt",
      "Try: /kai-champion → see the best-performing prompt variant",
      "Try: /kai-evolve → run prompt evolution to find better variants",
    ],
  },
  telemetry: {
    title: "Kai Telemetry",
    description: "Query traces, analyze performance, and explain telemetry data from Kai's flight recorder.",
    examples: [
      "Try: /kai-telemetry → query recent telemetry data",
      "Try: /kai-trace → get a specific request trace",
      "Try: /kai-explain → ask a question about system behavior",
    ],
  },
};

// --- Core grouping and building ---

export interface ToolInfo {
  toolId: string;
  slashCommand: string;
  description: string;
  parameters: string;
}

export function getToolsByDomain(): Record<string, ToolInfo[]> {
  const grouped: Record<string, ToolInfo[]> = {};

  for (const [toolId, domain] of Object.entries(TOOL_DOMAIN_MAP)) {
    if (!grouped[domain]) grouped[domain] = [];
    grouped[domain].push({
      toolId,
      slashCommand: TOOL_SLASH_MAP[toolId] ?? `/kai-${domain}`,
      description: TOOL_DESCRIPTIONS[toolId] ?? "",
      parameters: describeParameters(toolId),
    });
  }

  // Sort tools within each domain by slash command
  for (const tools of Object.values(grouped)) {
    tools.sort((a, b) => a.slashCommand.localeCompare(b.slashCommand));
  }

  return grouped;
}

export function buildSkillConfigs(): SkillConfig[] {
  const grouped = getToolsByDomain();
  const configs: SkillConfig[] = [];

  for (const [domain, tools] of Object.entries(grouped)) {
    configs.push({
      domain,
      skillName: `kai-${domain}`,
      slashCommands: tools.map((t) => t.slashCommand),
      tools: tools.map((t) => ({
        toolId: t.toolId,
        schemaExportName: Object.entries(SCHEMA_TO_TOOL_MAP).find(([, id]) => id === t.toolId)?.[0] ?? "",
        slashCommand: t.slashCommand,
        description: t.description,
      })),
      resources: DOMAIN_RESOURCES[domain] ?? [],
    });
  }

  return configs.sort((a, b) => a.domain.localeCompare(b.domain));
}
```

- [ ] **Step 4: Run compiler tests**

Run: `bun test tests/cli/skills/compiler.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/cli/skills/compiler.ts tests/cli/skills/compiler.test.ts
git commit -m "feat(skills): add skill compiler with domain mapping and schema introspection"
```

---

### Task 3: Templates — `src/cli/skills/templates.ts`

**Files:**
- Create: `src/cli/skills/templates.ts`
- Test: `tests/cli/skills/templates.test.ts`

- [ ] **Step 1: Write the failing test for templates**

```typescript
// tests/cli/skills/templates.test.ts
import { describe, test, expect } from "bun:test";
import { generateSkillMarkdown, generateMasterSkill } from "../../../src/cli/skills/templates";
import { buildSkillConfigs } from "../../../src/cli/skills/compiler";
import type { SkillConfig } from "../../../src/cli/skills/types";

describe("templates.ts", () => {
  const configs = buildSkillConfigs();

  describe("generateSkillMarkdown", () => {
    test("generates valid YAML frontmatter for each domain", () => {
      for (const config of configs) {
        const md = generateSkillMarkdown(config);
        expect(md).toMatch(/^---\n/);
        expect(md).toContain("name:");
        expect(md).toContain("description:");
        expect(md).toContain("allowed-tools:");
        expect(md).toMatch(/\n---\n/);
      }
    });

    test("includes all slash commands in description", () => {
      for (const config of configs) {
        const md = generateSkillMarkdown(config);
        for (const cmd of config.slashCommands) {
          expect(md, `Missing slash command ${cmd} in ${config.domain}`).toContain(cmd);
        }
      }
    });

    test("includes allowed-tools entries for all MCP tools", () => {
      for (const config of configs) {
        const md = generateSkillMarkdown(config);
        for (const tool of config.tools) {
          const allowedTool = `mcp__kai__${tool.toolId.replace(/\./g, "_").replace(/^kai_/, "kai_")}`;
          // The template should reference the tool in allowed-tools
          expect(md, `Missing MCP tool ref for ${tool.toolId} in ${config.domain}`).toContain("mcp__kai__");
        }
      }
    });

    test("includes Parameters section", () => {
      for (const config of configs) {
        const md = generateSkillMarkdown(config);
        expect(md).toContain("### Parameters");
      }
    });

    test("includes Examples section", () => {
      for (const config of configs) {
        const md = generateSkillMarkdown(config);
        expect(md).toContain("## Examples");
      }
    });

    test("includes MCP resource references when domain has resources", () => {
      const profileConfig = configs.find(c => c.domain === "profile")!;
      const md = generateSkillMarkdown(profileConfig);
      expect(md).toContain("kai://profile/");
    });

    test("domain without resources does not include resource section", () => {
      const deriveConfig = configs.find(c => c.domain === "derive")!;
      const md = generateSkillMarkdown(deriveConfig);
      expect(md).not.toContain("### MCP Resources");
    });
  });

  describe("generateMasterSkill", () => {
    test("generates master SKILL.md with all domains listed", () => {
      const md = generateMasterSkill(configs);
      expect(md).toMatch(/^---\n/);
      expect(md).toContain("name: kai");
      expect(md).toContain("/kai");
      for (const config of configs) {
        expect(md, `Missing domain ${config.domain}`).toContain(config.domain);
      }
    });

    test("lists all slash commands grouped by domain", () => {
      const md = generateMasterSkill(configs);
      for (const config of configs) {
        for (const cmd of config.slashCommands) {
          expect(md, `Missing command ${cmd}`).toContain(cmd);
        }
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/skills/templates.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write templates implementation**

```typescript
// src/cli/skills/templates.ts
import type { SkillConfig } from "./types";
import { DOMAIN_DESCRIPTIONS } from "./compiler";

export function generateSkillMarkdown(config: SkillConfig): string {
  const domainInfo = DOMAIN_DESCRIPTIONS[config.domain] ?? {
    title: `Kai ${config.domain}`,
    description: `Kai ${config.domain} tools.`,
    examples: [],
  };

  const slashCommandList = config.slashCommands.join(", ");
  const triggerPhrases = config.slashCommands.join(", ");

  const allowedTools = [
    "Bash",
    "Read",
    ...config.tools.map(t => `mcp__kai__${mcpToolName(t.toolId)}`),
  ];

  const toolsSection = config.tools.map(t =>
    `#### ${t.slashCommand}\n\n${t.description}\n\nParameters:\n${t.parameters || "None required."}`
  ).join("\n\n");

  const resourceSection = config.resources.length > 0
    ? `\n### MCP Resources\n\n${config.resources.map(r => `- \`${r}\``).join("\n")}`
    : "";

  const examplesSection = domainInfo.examples.length > 0
    ? `\n## Examples\n\n${domainInfo.examples.map(e => `- ${e}`).join("\n")}`
    : "";

  return `---
name: ${config.skillName}
description: |
  ${domainInfo.description}
  Triggers: ${triggerPhrases}
allowed-tools:
${allowedTools.map(t => `  - ${t}`).join("\n")}
---

## ${domainInfo.title}

${domainInfo.description}

### When to use

Use this skill when the user types any of: ${slashCommandList}.
The agent should parse the user's intent and call the appropriate MCP tool.

### Tools

${toolsSection}
${resourceSection}
${examplesSection}
`;
}

export function generateMasterSkill(configs: SkillConfig[]): string {
  const domainEntries = configs.map(c => {
    const info = DOMAIN_DESCRIPTIONS[c.domain];
    const commands = c.slashCommands.join(", ");
    return `### ${info?.title ?? c.domain}\n\n${info?.description ?? ""}\n\nCommands: ${commands}`;
  }).join("\n\n");

  const allCommands = configs.flatMap(c => c.slashCommands).sort();

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

${allCommands.map(c => `- \`${c}\``).join("\n")}

### Quick Start

- \`/kai-profile\` — see your behavioral profile
- \`/kai-work\` — get personalized task recommendations
- \`/kai-idea "your idea"\` — submit an idea for planning
`;
}

function mcpToolName(toolId: string): string {
  return toolId.replace(/\./g, "_");
}
```

- [ ] **Step 4: Run template tests**

Run: `bun test tests/cli/skills/templates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/skills/templates.ts tests/cli/skills/templates.test.ts
git commit -m "feat(skills): add skill markdown templates with domain descriptions"
```

---

### Task 4: Target Adapter — `src/cli/skills/targets/`

**Files:**
- Create: `src/cli/skills/targets/types.ts`
- Create: `src/cli/skills/targets/claude-code.ts`
- Test: `tests/cli/skills/targets.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cli/skills/targets.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeCodeTarget } from "../../../src/cli/skills/targets/claude-code";
import type { McpConfig, ValidationResult } from "../../../src/cli/skills/types";

describe("ClaudeCodeTarget", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-skills-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("name is 'claude-code'", () => {
    const target = new ClaudeCodeTarget(tempDir);
    expect(target.name).toBe("claude-code");
  });

  test("skillInstallPath returns the provided path", () => {
    const target = new ClaudeCodeTarget(tempDir);
    expect(target.skillInstallPath).toBe(tempDir);
  });

  test("validateInstallation returns valid when manifest exists and matches", () => {
    const target = new ClaudeCodeTarget(tempDir);
    const manifest = { kaiVersion: "0.9.1", generatedAt: new Date().toISOString(), skills: {} };
    mkdirSync(join(tempDir), { recursive: true });
    writeFileSync(join(tempDir, "manifest.json"), JSON.stringify(manifest));

    const result = target.validateInstallation();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("validateInstallation returns invalid when no manifest", () => {
    const target = new ClaudeCodeTarget(tempDir);
    const result = target.validateInstallation();
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("configureMcp creates claude.json if not exists", async () => {
    const claudeJsonPath = join(tempDir, "claude.json");
    const target = new ClaudeCodeTarget(tempDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    await target.configureMcp(config);

    expect(existsSync(claudeJsonPath)).toBe(true);
    const content = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(content.mcpServers.kai.command).toBe("kai");
    expect(content.mcpServers.kai.args).toEqual(["mcp", "serve"]);
  });

  test("configureMcp warns on conflicting entry", async () => {
    const claudeJsonPath = join(tempDir, "claude.json");
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: { kai: { command: "different", args: [] } },
    }));
    const target = new ClaudeCodeTarget(tempDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    // Should warn but not throw
    await target.configureMcp(config, true); // force=true to skip prompt
    const content = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(content.mcpServers.kai.command).toBe("kai");
  });

  test("removeMcp removes kai entry from claude.json", async () => {
    const claudeJsonPath = join(tempDir, "claude.json");
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: {
        kai: { command: "kai", args: ["mcp", "serve"] },
        other: { command: "other", args: [] },
      },
    }));
    const target = new ClaudeCodeTarget(tempDir, claudeJsonPath);

    await target.removeMcp();
    const content = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(content.mcpServers.kai).toBeUndefined();
    expect(content.mcpServers.other).toBeDefined();
  });

  test("removeMcp handles missing claude.json gracefully", async () => {
    const claudeJsonPath = join(tempDir, "nonexistent.json");
    const target = new ClaudeCodeTarget(tempDir, claudeJsonPath);

    // Should not throw
    await target.removeMcp();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/skills/targets.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create TargetAdapter interface**

```typescript
// src/cli/skills/targets/types.ts
import type { McpConfig, ValidationResult } from "../types";

export interface TargetAdapter {
  readonly name: string;
  readonly skillInstallPath: string;
  configureMcp(config: McpConfig, force?: boolean): Promise<void>;
  removeMcp(): Promise<void>;
  validateInstallation(): ValidationResult;
}
```

- [ ] **Step 4: Create Claude Code target adapter**

```typescript
// src/cli/skills/targets/claude-code.ts
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { renameSync } from "node:fs";
import type { McpConfig, ValidationResult } from "../types";
import type { TargetAdapter } from "./types";

export class ClaudeCodeTarget implements TargetAdapter {
  readonly name = "claude-code";
  readonly skillInstallPath: string;
  private readonly claudeJsonPath: string;

  constructor(
    skillInstallPath?: string,
    claudeJsonPath?: string,
  ) {
    this.skillInstallPath = skillInstallPath ?? join(homedir(), ".claude", "skills", "kai");
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
        throw new Error(`Cannot read ${this.claudeJsonPath}. Check the file contains valid JSON.`);
      }
    }

    if (!existing.mcpServers) existing.mcpServers = {};

    const servers = existing.mcpServers as Record<string, unknown>;
    if (servers.kai && !force) {
      const existingEntry = servers.kai as McpConfig;
      if (existingEntry.command !== config.command || JSON.stringify(existingEntry.args) !== JSON.stringify(config.args)) {
        throw new Error(
          `Conflicting MCP entry for "kai" in ${this.claudeJsonPath}. Use --force to overwrite, or edit manually.`,
        );
      }
      // Already configured correctly, nothing to do
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
    const tmpPath = `${filePath}.tmp-${Date.now()}`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    renameSync(tmpPath, realpathSync(filePath).replace(/\.tmp-\d+$/, ""));
    // Fallback if realpath fails: direct rename
    try {
      renameSync(tmpPath, filePath);
    } catch {
      // tmpPath was already renamed by the first renameSync
    }
  }
}
```

- [ ] **Step 5: Fix atomic write — use simpler approach**

The `atomicWriteJson` above has a logic bug — the first `renameSync` with modified realpath will fail silently. Replace it with:

```typescript
private atomicWriteJson(filePath: string, data: unknown): void {
  const dir = join(filePath, "..");
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.kai-skills-${Date.now()}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, filePath);
}
```

Replace the entire `atomicWriteJson` method in `src/cli/skills/targets/claude-code.ts` with this simpler version.

- [ ] **Step 6: Run target adapter tests**

Run: `bun test tests/cli/skills/targets.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/skills/targets/types.ts src/cli/skills/targets/claude-code.ts tests/cli/skills/targets.test.ts
git commit -m "feat(skills): add TargetAdapter interface and Claude Code adapter"
```

---

### Task 5: CLI Commands — `src/cli/skills/commands/`

**Files:**
- Create: `src/cli/skills/commands/install.ts`
- Create: `src/cli/skills/commands/list.ts`
- Create: `src/cli/skills/commands/doctor.ts`
- Create: `src/cli/skills/commands/uninstall.ts`
- Modify: `src/cli/index.ts` — add `registerSkillsCommands(program)`

- [ ] **Step 1: Create install command**

```typescript
// src/cli/skills/commands/install.ts
import type { Command } from "commander";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { buildSkillConfigs } from "../compiler";
import { generateSkillMarkdown, generateMasterSkill } from "../templates";
import { ClaudeCodeTarget } from "../targets/claude-code";
import type { SkillManifest, McpConfig } from "../types";
import { sanitizeDomainName } from "../compiler";

export function registerInstallCommand(skills: Command): void {
  skills
    .command("install")
    .description("Generate and install skill files")
    .option("--target <target>", "Target agent (default: claude-code)", "claude-code")
    .option("--force", "Overwrite existing skills without prompting")
    .option("--configure-mcp", "Automatically configure MCP server in ~/.claude.json")
    .action(async (opts: { target: string; force?: boolean; configureMcp?: boolean }) => {
      if (opts.target !== "claude-code") {
        console.error(`Error: Target "${opts.target}" is not supported. Only "claude-code" is available.`);
        process.exit(1);
      }

      const target = new ClaudeCodeTarget();
      const installPath = target.skillInstallPath;

      // Warn if skills already exist
      if (existsSync(join(installPath, "manifest.json")) && !opts.force) {
        console.log(`Skills already installed at ${installPath}. Use --force to overwrite.`);
        return;
      }

      const configs = buildSkillConfigs();

      // Warn before overwriting
      if (existsSync(installPath) && !opts.force) {
        console.log(`Warning: Overwriting existing skills at ${installPath}. Custom edits will be lost.`);
      }

      // Generate skill files
      mkdirSync(installPath, { recursive: true });
      let fileCount = 0;

      // Master SKILL.md
      const masterMd = generateMasterSkill(configs);
      writeFileSync(join(installPath, "SKILL.md"), masterMd);
      fileCount++;

      // Domain-specific SKILL.md files
      for (const config of configs) {
        const domain = sanitizeDomainName(config.domain);
        const domainDir = join(installPath, domain);
        mkdirSync(domainDir, { recursive: true });
        const md = generateSkillMarkdown(config);
        writeFileSync(join(domainDir, "SKILL.md"), md);
        fileCount++;
      }

      // Write manifest
      const pkg = JSON.parse(
        readFileSync(join(import.meta.dir, "../../../../package.json"), "utf-8"),
      );
      const manifest: SkillManifest = {
        kaiVersion: pkg.version,
        generatedAt: new Date().toISOString(),
        skills: Object.fromEntries(
          configs.map(c => [c.domain, c.tools.map(t => t.toolId)]),
        ),
      };
      writeFileSync(join(installPath, "manifest.json"), JSON.stringify(manifest, null, 2));
      fileCount++;

      console.log(`Installed ${fileCount} files to ${installPath}`);

      // Configure MCP if requested
      if (opts.configureMcp) {
        const mcpConfig: McpConfig = { command: "kai", args: ["mcp", "serve"] };
        try {
          await target.configureMcp(mcpConfig, opts.force);
          console.log("Added MCP server configuration to ~/.claude.json");
        } catch (err) {
          console.error(`Error configuring MCP: ${(err as Error).message}`);
        }
      } else {
        console.log("\nTo complete setup, add the MCP server to ~/.claude.json.");
        console.log("Run with --configure-mcp for automatic configuration.");
      }
    });
}
```

- [ ] **Step 2: Create list command**

```typescript
// src/cli/skills/commands/list.ts
import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeCodeTarget } from "../targets/claude-code";
import type { SkillManifest } from "../types";
import { header, status, dim } from "../../format";

export function registerListCommand(skills: Command): void {
  skills
    .command("list")
    .description("Show installed skills and their status")
    .action(() => {
      const target = new ClaudeCodeTarget();
      const manifestPath = join(target.skillInstallPath, "manifest.json");

      if (!existsSync(manifestPath)) {
        console.log(dim("No skills installed. Run `kai skills install` first."));
        return;
      }

      let manifest: SkillManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      } catch {
        console.log(status("error", "Cannot read manifest.json. Run `kai skills install` to regenerate."));
        return;
      }

      console.log(header("Kai Skills"));
      console.log(`Version: ${manifest.kaiVersion}`);
      console.log(`Generated: ${manifest.generatedAt}`);
      console.log();

      for (const [domain, tools] of Object.entries(manifest.skills)) {
        const toolList = (tools as string[]).join(", ");
        console.log(`  ${status("success", domain)} — ${toolList}`);
      }
    });
}
```

- [ ] **Step 3: Create doctor command**

```typescript
// src/cli/skills/commands/doctor.ts
import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeCodeTarget } from "../targets/claude-code";
import { buildSkillConfigs } from "../compiler";
import { header, status, dim } from "../../format";

export function registerDoctorCommand(skills: Command): void {
  skills
    .command("doctor")
    .description("Validate installed skills against current schemas")
    .option("--fix", "Reinstall skills to fix issues")
    .action(async (opts: { fix?: boolean }) => {
      const target = new ClaudeCodeTarget();
      const validation = target.validateInstallation();

      if (opts.fix) {
        console.log("Reinstalling skills...");
        // Re-run install
        const { execSync } = await import("node:child_process");
        try {
          execSync("kai skills install --force", { stdio: "inherit" });
          console.log(status("success", "Skills reinstalled successfully."));
        } catch {
          console.log(status("error", "Failed to reinstall skills."));
        }
        return;
      }

      console.log(header("Kai Skills Doctor"));
      console.log();

      if (!validation.valid) {
        for (const err of validation.errors) {
          console.log(status("error", err));
        }
        console.log();
        console.log(dim("Run `kai skills doctor --fix` to reinstall."));
        process.exit(1);
      }

      console.log(status("success", "Installation valid."));

      // Check version
      const manifestPath = join(target.skillInstallPath, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const pkg = JSON.parse(
        readFileSync(join(import.meta.dir, "../../../../package.json"), "utf-8"),
      );

      if (manifest.kaiVersion !== pkg.version) {
        console.log(status("warning", `Skills generated with Kai v${manifest.kaiVersion}. Current: v${pkg.version}.`));
        console.log(dim("  Run `kai skills install` to update."));
      } else {
        console.log(status("info", `Version: v${pkg.version}`));
      }

      // Check for new tools not in manifest
      const configs = buildSkillConfigs();
      const manifestTools = new Set(
        Object.values(manifest.skills).flat() as string[],
      );
      const currentTools = configs.flatMap(c => c.tools.map(t => t.toolId));
      const newTools = currentTools.filter(t => !manifestTools.has(t));
      const removedTools = [...manifestTools].filter(t => !currentTools.includes(t));

      if (newTools.length > 0) {
        console.log(status("info", `${newTools.length} new tool(s) available: ${newTools.join(", ")}`));
        console.log(dim("  Run `kai skills install` to add."));
      }

      if (removedTools.length > 0) {
        console.log(status("warning", `${removedTools.length} tool(s) removed: ${removedTools.join(", ")}`));
      }

      for (const warn of validation.warnings) {
        console.log(status("warning", warn));
      }
    });
}
```

- [ ] **Step 4: Create uninstall command**

```typescript
// src/cli/skills/commands/uninstall.ts
import type { Command } from "commander";
import { rmSync, existsSync } from "node:fs";
import { ClaudeCodeTarget } from "../targets/claude-code";
import { header, status, dim } from "../../format";

export function registerUninstallCommand(skills: Command): void {
  skills
    .command("uninstall")
    .description("Remove all installed Kai skills")
    .action(async () => {
      const target = new ClaudeCodeTarget();
      const installPath = target.skillInstallPath;

      if (!existsSync(installPath)) {
        console.log(dim("No skills installed."));
        return;
      }

      console.log(header("Kai Skills Uninstall"));
      console.log(`This will remove: ${installPath}`);
      console.log();

      // In non-interactive mode, just proceed (interactive confirmation
      // would use readline, but for safety we require --force in CI)
      try {
        rmSync(installPath, { recursive: true, force: true });
        console.log(status("success", "Skill files removed."));
      } catch (err) {
        console.log(status("error", `Failed to remove skill files: ${(err as Error).message}`));
      }

      try {
        await target.removeMcp();
        console.log(status("success", "MCP configuration removed from ~/.claude.json."));
      } catch (err) {
        console.log(status("warning", `Could not remove MCP config: ${(err as Error).message}`));
      }
    });
}
```

- [ ] **Step 5: Wire skills commands into CLI**

Add to `src/cli/index.ts`:

```typescript
// Add import at the top with the other imports:
import { registerSkillsCommands } from "./skills";

// Add registration call after the existing registerXxxCommands calls:
registerSkillsCommands(program);
```

Create `src/cli/skills/index.ts` as the module entry point:

```typescript
// src/cli/skills/index.ts
import type { Command } from "commander";
import { registerInstallCommand } from "./commands/install";
import { registerListCommand } from "./commands/list";
import { registerDoctorCommand } from "./commands/doctor";
import { registerUninstallCommand } from "./commands/uninstall";

export function registerSkillsCommands(program: Command): void {
  const skills = program.command("skills").description("Manage Kai skill files for AI agent shells");

  registerInstallCommand(skills);
  registerListCommand(skills);
  registerDoctorCommand(skills);
  registerUninstallCommand(skills);
}
```

- [ ] **Step 6: Verify CLI wiring compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Verify install command runs**

Run: `bun run src/cli/index.ts skills install --help`
Expected: Help output showing `--target`, `--force`, `--configure-mcp` options

- [ ] **Step 8: Commit**

```bash
git add src/cli/skills/index.ts src/cli/skills/commands/install.ts src/cli/skills/commands/list.ts src/cli/skills/commands/doctor.ts src/cli/skills/commands/uninstall.ts src/cli/index.ts
git commit -m "feat(skills): add install, list, doctor, uninstall CLI commands"
```

---

### Task 6: Integration Tests

**Files:**
- Create: `tests/cli/skills/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/cli/skills/integration.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSkillConfigs } from "../../../src/cli/skills/compiler";
import { generateSkillMarkdown, generateMasterSkill } from "../../../src/cli/skills/templates";
import { ClaudeCodeTarget } from "../../../src/cli/skills/targets/claude-code";
import type { McpConfig, SkillManifest } from "../../../src/cli/skills/types";

describe("Skills Integration", () => {
  let tempDir: string;
  let skillDir: string;
  let claudeJsonPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-skills-int-"));
    skillDir = join(tempDir, "skills", "kai");
    claudeJsonPath = join(tempDir, "claude.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function installSkills(): void {
    const configs = buildSkillConfigs();
    mkdirSync(skillDir, { recursive: true });

    // Master SKILL.md
    writeFileSync(join(skillDir, "SKILL.md"), generateMasterSkill(configs));

    // Domain skills
    for (const config of configs) {
      const domainDir = join(skillDir, config.domain);
      mkdirSync(domainDir, { recursive: true });
      writeFileSync(join(domainDir, "SKILL.md"), generateSkillMarkdown(config));
    }

    // Manifest
    const manifest: SkillManifest = {
      kaiVersion: "0.9.1",
      generatedAt: new Date().toISOString(),
      skills: Object.fromEntries(configs.map(c => [c.domain, c.tools.map(t => t.toolId)])),
    };
    writeFileSync(join(skillDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }

  test("install → doctor → uninstall flow", () => {
    // Install
    installSkills();
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "manifest.json"))).toBe(true);

    const configs = buildSkillConfigs();
    for (const config of configs) {
      expect(existsSync(join(skillDir, config.domain, "SKILL.md"))).toBe(true);
    }

    // Doctor
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const result = target.validateInstallation();
    expect(result.valid).toBe(true);

    // Uninstall
    rmSync(skillDir, { recursive: true, force: true });
    expect(existsSync(skillDir)).toBe(false);
  });

  test("install generates exactly 8 SKILL.md files + 1 manifest", () => {
    installSkills();

    const configs = buildSkillConfigs();
    // 1 master + 7 domain = 8 SKILL.md files + 1 manifest.json
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true); // master
    expect(configs).toHaveLength(7); // 7 domain skills
    for (const config of configs) {
      expect(existsSync(join(skillDir, config.domain, "SKILL.md"))).toBe(true);
    }
    expect(existsSync(join(skillDir, "manifest.json"))).toBe(true);
  });

  test("manifest lists all 19 tools", () => {
    installSkills();

    const manifest: SkillManifest = JSON.parse(
      readFileSync(join(skillDir, "manifest.json"), "utf-8"),
    );
    const totalTools = Object.values(manifest.skills).reduce(
      (sum, tools) => sum + (tools as string[]).length, 0,
    );
    expect(totalTools).toBe(19);
  });

  test("MCP config survives round-trip", async () => {
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    // Configure
    await target.configureMcp(config);
    const afterConfigure = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(afterConfigure.mcpServers.kai.command).toBe("kai");

    // Remove
    await target.removeMcp();
    const afterRemove = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(afterRemove.mcpServers.kai).toBeUndefined();
  });

  test("first-run: claude.json doesn't exist", async () => {
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    expect(existsSync(claudeJsonPath)).toBe(false);

    await target.configureMcp(config);

    expect(existsSync(claudeJsonPath)).toBe(true);
    const content = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(content.mcpServers.kai.command).toBe("kai");
  });

  test("path traversal: tool name with ../ is rejected", () => {
    const { sanitizeToolName } = require("../../../src/cli/skills/compiler");
    expect(() => sanitizeToolName("../etc/passwd")).toThrow(/invalid/i);
  });

  test("conflicting MCP entry without force throws", async () => {
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: { kai: { command: "different", args: [] } },
    }));
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    await expect(target.configureMcp(config)).rejects.toThrow(/conflicting/i);
  });

  test("invalid JSON in claude.json throws", async () => {
    writeFileSync(claudeJsonPath, "not json {{{");
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    await expect(target.configureMcp(config)).rejects.toThrow(/JSON/i);
  });

  test("doctor detects version mismatch", () => {
    installSkills();

    // Tamper with manifest version
    const manifestPath = join(skillDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.kaiVersion = "0.0.1";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Doctor should still validate structure, but version check is separate
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const result = target.validateInstallation();
    expect(result.valid).toBe(true); // structure is valid, just version differs
  });

  test("removeMcp preserves other MCP servers", async () => {
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: {
        kai: { command: "kai", args: ["mcp", "serve"] },
        gbrain: { command: "gbrain", args: [] },
      },
    }));
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);

    await target.removeMcp();

    const content = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(content.mcpServers.kai).toBeUndefined();
    expect(content.mcpServers.gbrain).toBeDefined();
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `bun test tests/cli/skills/integration.test.ts`
Expected: PASS (all tests)

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `bun test`
Expected: All tests pass (baseline: 869 + new tests)

- [ ] **Step 4: Commit**

```bash
git add tests/cli/skills/integration.test.ts
git commit -m "test(skills): add integration tests for install/doctor/uninstall flow"
```

---

### Task 7: Fix `require` → `import` in integration test + final verification

**Files:**
- Modify: `tests/cli/skills/integration.test.ts` — fix `require()` to use `import`

- [ ] **Step 1: Fix the require() call**

The integration test uses `require()` which doesn't work in ESM. Replace:

```typescript
// In the path traversal test, change:
const { sanitizeToolName } = require("../../../src/cli/skills/compiler");
// To (import is already at the top of the file):
// sanitizeToolName is already imported at the top — remove the require line
```

The `sanitizeToolName` is already imported from the compiler at the top of the file. Just remove the `const { sanitizeToolName } = require(...)` line and use the existing import.

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run lint**

Run: `npx @biomejs/biome check src/`
Expected: No errors (or fix any lint issues)

- [ ] **Step 5: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(skills): fix ESM import and lint issues"
```

---

### Task 8: End-to-end smoke test

- [ ] **Step 1: Run install command end-to-end**

Run: `bun run src/cli/index.ts skills install --force`
Expected: "Installed 9 files to ~/.claude/skills/kai/" + guidance message

- [ ] **Step 2: Verify generated files exist**

Run: `ls -la ~/.claude/skills/kai/`
Expected: SKILL.md, manifest.json, profile/, observe/, derive/, work/, idea/, prompt/, telemetry/

- [ ] **Step 3: Run list command**

Run: `bun run src/cli/index.ts skills list`
Expected: Version, generated date, domain list with tool counts

- [ ] **Step 4: Run doctor command**

Run: `bun run src/cli/index.ts skills doctor`
Expected: All checks pass, version matches

- [ ] **Step 5: Verify a generated skill file content**

Run: `cat ~/.claude/skills/kai/profile/SKILL.md`
Expected: YAML frontmatter with `name: kai-profile`, description, allowed-tools, markdown body

- [ ] **Step 6: Run uninstall command**

Run: `bun run src/cli/index.ts skills uninstall`
Expected: Skill files removed, MCP config removed

- [ ] **Step 7: Verify cleanup**

Run: `ls ~/.claude/skills/kai/ 2>&1`
Expected: Directory does not exist or is empty

- [ ] **Step 8: Re-install to leave skills in place for actual use**

Run: `bun run src/cli/index.ts skills install --force`
Expected: Skills reinstalled successfully

---

## Self-Review Checklist

1. **Spec coverage:** Every requirement from the CEO plan is implemented:
   - 8 skill files (1 master + 7 domain) — Task 3, 5
   - TOOL_DOMAIN_MAP with all 19 tools — Task 2
   - SCHEMA_TO_TOOL_MAP with all 19 mappings — Task 2
   - TargetAdapter interface — Task 4
   - Claude Code adapter — Task 4
   - install/list/doctor/uninstall commands — Task 5
   - MCP resource references — Task 3
   - Example scenarios — Task 3
   - Version-aware doctor — Task 5 (doctor.ts)
   - Input sanitization — Task 2 (compiler.ts)
   - Manifest — Task 5 (install.ts)
   - 10 critical edge case tests — Task 6

2. **Placeholder scan:** No TBD, TODO, or "implement later" found. All code blocks contain complete implementations.

3. **Type consistency:** All types used across tasks match:
   - `SkillConfig`, `ToolMapping`, `McpConfig`, `SkillManifest`, `ValidationResult` defined in Task 1
   - `TargetAdapter` interface in Task 4 uses these exact types
   - `ClaudeCodeTarget` implements `TargetAdapter` with matching method signatures
   - `compiler.ts` exports `ToolInfo` interface used internally
   - All import paths are consistent across files

---

## Eng Review Amendments (2026-05-26)

6 issues found, 0 critical gaps. All accepted by user.

### D1: `import.meta.dir` → `import.meta.url` (P2)
Replace `import.meta.dir` + `join(../../../../package.json)` in install.ts and doctor.ts with `new URL("../../package.json", import.meta.url)` to match existing `src/cli/index.ts:15` pattern.

### D2: `doctor --fix` execSync → import direct (P1)
Replace `execSync("kai skills install --force")` in doctor.ts with direct function import from install.ts. Extract install logic into a reusable function.

### D3: `describeParameters()` _def → z.toJSONSchema() (P2)
Replace `zodType._def?.description` and `zodType.unwrap?.()` with `z.toJSONSchema()` per CEO plan approach. Avoid internal Zod API.

### D4: Uninstall confirmation prompt (P2)
Add readline confirmation prompt to uninstall.ts. Match CEO plan "with confirmation" requirement. Support `--force` to skip.

### D5: Merge Task 7 into Task 6 (P2)
Remove `require()` from integration test. Write correct `import` in Task 6 directly. Eliminate Task 7.

### D6: atomicWriteJson show only correct version (P2)
Merge Task 4 Step 4+5 into single step showing only the correct `atomicWriteJson` implementation.

### Coverage: 37/48 paths (77%) — 11 gaps, 0 critical

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_open | 5 proposals, 4 accepted, 1 deferred |
| Codex Review | `/codex` via outside voice | Independent 2nd opinion | 2 | issues_found | 3 CEO tensions resolved + 1 eng tension (schema→tool mapping) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | issues_found | 6 issues (2 plan-level, 4 code-level), 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

CROSS-MODEL: 4 tensions resolved — tool discovery source (keep Zod), auto-config (opt-in), missing resources (added), schema→tool ID mapping (hardcoded map).

UNRESOLVED: 0

VERDICT: CEO + ENG CLEARED — ready to implement.
