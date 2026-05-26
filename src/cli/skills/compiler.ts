// src/cli/skills/compiler.ts
// Domain mapping, schema introspection, and tool grouping for the Dynamic Skill Compiler.

import { z } from "zod";
import {
  ExecutionStatusSchema,
  IdeaPauseSchema,
  IdeaPlanSchema,
  IdeaSubmitSchema,
  PlanApproveSchema,
  ReplanSchema,
  TaskExecuteSchema,
} from "../../mcp/orchestrator-schema";
import {
  PromptChampionSchema,
  PromptCompileSchema,
  PromptEvolveSchema,
} from "../../mcp/prompt-schema";
import {
  DeriveTriggerSchema,
  ObserveBatchSchema,
  ObserveSubmitSchema,
  ProfileReadSchema,
  ProfileWhySchema,
  WorkRecommendSchema,
} from "../../mcp/schema";
import {
  TelemetryExplainSchema,
  TelemetryQuerySchema,
  TelemetryTraceSchema,
} from "../../mcp/telemetry-schema";
import type { SkillConfig } from "./types";

// ---------------------------------------------------------------------------
// Tool info interface (exported for consumers)
// ---------------------------------------------------------------------------

export interface ToolInfo {
  toolId: string;
  slashCommand: string;
  description: string;
  parameters: string;
}

// ---------------------------------------------------------------------------
// 1. TOOL_DOMAIN_MAP — every MCP tool → domain
// ---------------------------------------------------------------------------

export const TOOL_DOMAIN_MAP: Record<string, string> = {
  // profile
  "profile.read": "profile",
  "profile.why": "profile",

  // observe
  "observe.submit": "observe",
  "observe.batch": "observe",

  // derive
  "derive.trigger": "derive",

  // work
  kai_work_recommend: "work",
  kai_execution_status: "work",

  // idea (orchestrator)
  kai_idea_submit: "idea",
  kai_idea_plan: "idea",
  kai_plan_approve: "idea",
  kai_task_execute: "idea",
  kai_idea_pause: "idea",
  kai_replan: "idea",

  // prompt
  "prompt.compile": "prompt",
  "prompt.champion": "prompt",
  "prompt.evolve": "prompt",

  // telemetry
  "telemetry.query": "telemetry",
  "telemetry.trace": "telemetry",
  "telemetry.explain": "telemetry",
};

// ---------------------------------------------------------------------------
// 2. SCHEMA_TO_TOOL_MAP — schema export name → tool ID
// ---------------------------------------------------------------------------

export const SCHEMA_TO_TOOL_MAP: Record<string, string> = {
  // core
  ProfileReadSchema: "profile.read",
  ProfileWhySchema: "profile.why",
  ObserveSubmitSchema: "observe.submit",
  ObserveBatchSchema: "observe.batch",
  DeriveTriggerSchema: "derive.trigger",
  WorkRecommendSchema: "kai_work_recommend",

  // orchestrator
  IdeaSubmitSchema: "kai_idea_submit",
  IdeaPlanSchema: "kai_idea_plan",
  PlanApproveSchema: "kai_plan_approve",
  TaskExecuteSchema: "kai_task_execute",
  IdeaPauseSchema: "kai_idea_pause",
  ExecutionStatusSchema: "kai_execution_status",
  ReplanSchema: "kai_replan",

  // prompt
  PromptCompileSchema: "prompt.compile",
  PromptChampionSchema: "prompt.champion",
  PromptEvolveSchema: "prompt.evolve",

  // telemetry
  TelemetryQuerySchema: "telemetry.query",
  TelemetryTraceSchema: "telemetry.trace",
  TelemetryExplainSchema: "telemetry.explain",
};

// ---------------------------------------------------------------------------
// 3. TOOL_SLASH_MAP — tool ID → slash command
// ---------------------------------------------------------------------------

export const TOOL_SLASH_MAP: Record<string, string> = {
  "profile.read": "/kai-profile",
  "profile.why": "/kai-why",
  "observe.submit": "/kai-observe",
  "observe.batch": "/kai-observe-batch",
  "derive.trigger": "/kai-derive",
  kai_work_recommend: "/kai-work",
  kai_idea_submit: "/kai-idea",
  kai_idea_plan: "/kai-plan",
  kai_plan_approve: "/kai-approve",
  kai_task_execute: "/kai-execute",
  kai_idea_pause: "/kai-pause",
  kai_execution_status: "/kai-status",
  kai_replan: "/kai-replan",
  "prompt.compile": "/kai-prompt",
  "prompt.champion": "/kai-champion",
  "prompt.evolve": "/kai-evolve",
  "telemetry.query": "/kai-telemetry",
  "telemetry.trace": "/kai-trace",
  "telemetry.explain": "/kai-explain",
};

// ---------------------------------------------------------------------------
// 4. DOMAIN_RESOURCES — resource URIs grouped by domain
// ---------------------------------------------------------------------------

export const DOMAIN_RESOURCES: Record<string, string[]> = {
  profile: [
    "kai://profile/identity",
    "kai://profile/traits",
    "kai://profile/traits/{dimension}",
    "kai://profile/observations/recent",
    "kai://profile/summary",
  ],
  observe: ["kai://profile/observations/recent"],
  work: ["kai://system/health"],
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
  derive: [],
  idea: [],
};

// ---------------------------------------------------------------------------
// 5. TOOL_DESCRIPTIONS — human-readable descriptions for all 19 tools
// ---------------------------------------------------------------------------

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  "profile.read":
    "Read the behavioral profile in various scopes (summary, identity, traits, full)",
  "profile.why":
    "Explain why a specific trait dimension was derived from observations",
  "observe.submit":
    "Submit a single behavioral observation to the profile engine",
  "observe.batch":
    "Submit multiple behavioral observations in a single batch call",
  "derive.trigger": "Trigger profile derivation from accumulated observations",
  kai_work_recommend:
    "Get personalized work recommendations based on the behavioral profile",
  kai_idea_submit: "Submit a new idea to the orchestrator for planning",
  kai_idea_plan: "Generate an execution plan for a submitted idea",
  kai_plan_approve: "Approve (with optional modifications) a generated plan",
  kai_task_execute: "Execute a specific task from an approved plan",
  kai_idea_pause: "Pause execution of an idea and its tasks",
  kai_execution_status: "Check execution status of ideas and tasks",
  kai_replan: "Re-plan an existing idea, adapting to new information",
  "prompt.compile": "Compile the system prompt for a given task type",
  "prompt.champion": "Get the champion prompt for a task segment",
  "prompt.evolve": "Run prompt evolution rounds for a given task",
  "telemetry.query":
    "Query the telemetry store with SQL (SELECT only against views)",
  "telemetry.trace": "Retrieve the full causal trace for a given trace ID",
  "telemetry.explain":
    "Ask a natural language question about recent telemetry data",
};

// ---------------------------------------------------------------------------
// 6. DOMAIN_DESCRIPTIONS — metadata for each of the 7 domains
// ---------------------------------------------------------------------------

export const DOMAIN_DESCRIPTIONS: Record<
  string,
  { title: string; description: string; examples: string[] }
> = {
  profile: {
    title: "Kai Profile",
    description:
      "Read and explore the user's behavioral profile — traits, identity, and the reasoning behind each dimension.",
    examples: [
      "Try: /kai-profile → see your behavioral profile summary",
      "Try: /kai-profile scope=full → see everything Kai knows about you",
      "Try: /kai-why early_riser → understand why Kai thinks you're an early riser",
    ],
  },
  observe: {
    title: "Kai Observe",
    description:
      "Submit behavioral observations that feed into Kai's profile engine. Each observation helps Kai learn about the user.",
    examples: [
      'Try: /kai-observe "User prefers dark mode in all tools" → submit an observation',
      "Try: /kai-observe-batch → submit multiple observations at once",
    ],
  },
  derive: {
    title: "Kai Derive",
    description:
      "Trigger profile derivation to re-process observations and update the behavioral profile.",
    examples: [
      "Try: /kai-derive → re-derive the profile from all observations",
      "Try: /kai-derive method=llm → use LLM-based derivation",
    ],
  },
  work: {
    title: "Kai Work",
    description:
      "Get personalized task recommendations and check execution status based on the user's behavioral profile.",
    examples: [
      "Try: /kai-work → get personalized task recommendations",
      "Try: /kai-status → check current task execution status",
    ],
  },
  idea: {
    title: "Kai Idea Orchestrator",
    description:
      "Submit ideas, generate plans, approve and execute tasks. The full idea-to-execution pipeline powered by behavioral intelligence.",
    examples: [
      'Try: /kai-idea "Build a personal dashboard" → submit an idea for planning',
      "Try: /kai-plan → generate an execution plan for an idea",
      "Try: /kai-approve → approve a plan and queue for execution",
    ],
  },
  prompt: {
    title: "Kai Prompt Engine",
    description:
      "Compile, inspect, and evolve the prompts that drive Kai's core engines (planner, derivator, observer).",
    examples: [
      "Try: /kai-prompt → compile and view the current planner prompt",
      "Try: /kai-champion → see the best-performing prompt variant",
      "Try: /kai-evolve → run prompt evolution to find better variants",
    ],
  },
  telemetry: {
    title: "Kai Telemetry",
    description:
      "Query traces, analyze performance, and explain telemetry data from Kai's flight recorder.",
    examples: [
      "Try: /kai-telemetry → query recent telemetry data",
      "Try: /kai-trace → get a specific request trace",
      "Try: /kai-explain → ask a question about system behavior",
    ],
  },
};

// ---------------------------------------------------------------------------
// 7. Schema registry — maps toolId → plain schema object for introspection
// ---------------------------------------------------------------------------

const SCHEMA_REGISTRY: Record<string, Record<string, z.ZodTypeAny>> = {
  "profile.read": ProfileReadSchema,
  "profile.why": ProfileWhySchema,
  "observe.submit": ObserveSubmitSchema,
  "observe.batch": ObserveBatchSchema,
  "derive.trigger": DeriveTriggerSchema,
  kai_work_recommend: WorkRecommendSchema,
  kai_idea_submit: IdeaSubmitSchema,
  kai_idea_plan: IdeaPlanSchema,
  kai_plan_approve: PlanApproveSchema,
  kai_task_execute: TaskExecuteSchema,
  kai_idea_pause: IdeaPauseSchema,
  kai_execution_status: ExecutionStatusSchema,
  kai_replan: ReplanSchema,
  "prompt.compile": PromptCompileSchema,
  "prompt.champion": PromptChampionSchema,
  "prompt.evolve": PromptEvolveSchema,
  "telemetry.query": TelemetryQuerySchema,
  "telemetry.trace": TelemetryTraceSchema,
  "telemetry.explain": TelemetryExplainSchema,
};

// ---------------------------------------------------------------------------
// describeParameters — uses Zod v4 official toJSONSchema API
// ---------------------------------------------------------------------------

export function describeParameters(toolId: string): string {
  const schemaObj = SCHEMA_REGISTRY[toolId];
  if (!schemaObj) return "(no parameters)";

  try {
    // Wrap the plain object in z.object() then convert to JSON Schema
    const zodObject = z.object(schemaObj);
    // Zod v4 uses uppercase toJSONSchema
    const jsonSchema = z.toJSONSchema(zodObject) as {
      properties?: Record<
        string,
        { type?: string; description?: string; $ref?: string; enum?: string[] }
      >;
      required?: string[];
    };

    const props = jsonSchema.properties;
    if (!props || Object.keys(props).length === 0) return "(no parameters)";

    const lines: string[] = [];
    for (const [name, prop] of Object.entries(props)) {
      const parts: string[] = [];
      if (prop.type) parts.push(prop.type);
      if (prop.enum) parts.push(`one of: ${prop.enum.join(", ")}`);
      const typeStr = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      const descStr = prop.description ? ` — ${prop.description}` : "";
      lines.push(`  - ${name}${typeStr}${descStr}`);
    }
    return lines.join("\n");
  } catch {
    // Fallback: iterate keys and describe types simply
    const keys = Object.keys(schemaObj);
    if (keys.length === 0) return "(no parameters)";

    return keys.map((k) => `  - ${k}`).join("\n");
  }
}

// ---------------------------------------------------------------------------
// 8. sanitizeToolName — validate tool IDs
// ---------------------------------------------------------------------------

const VALID_TOOL_NAME = /^[a-zA-Z0-9_.]+$/;

export function sanitizeToolName(name: string): string {
  if (!name || name.length === 0) {
    throw new Error(`Invalid tool name: empty string`);
  }
  if (name.includes("..") || !VALID_TOOL_NAME.test(name)) {
    throw new Error(`Invalid tool name: ${name}`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// 9. sanitizeDomainName — validate domain names
// ---------------------------------------------------------------------------

const VALID_DOMAIN_NAME = /^[a-z][a-z0-9-]*$/;

export function sanitizeDomainName(name: string): string {
  if (!name || name.length === 0) {
    throw new Error(`Invalid domain name: empty string`);
  }
  if (name.includes("/") || name === ".." || !VALID_DOMAIN_NAME.test(name)) {
    throw new Error(`Invalid domain name: ${name}`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// 10. getToolsByDomain — groups tools by domain, returns ToolInfo[]
// ---------------------------------------------------------------------------

export function getToolsByDomain(): Record<string, ToolInfo[]> {
  const grouped: Record<string, ToolInfo[]> = {};

  for (const [toolId, domain] of Object.entries(TOOL_DOMAIN_MAP)) {
    if (!grouped[domain]) grouped[domain] = [];

    grouped[domain].push({
      toolId,
      slashCommand: TOOL_SLASH_MAP[toolId] ?? "",
      description: TOOL_DESCRIPTIONS[toolId] ?? "",
      parameters: describeParameters(toolId),
    });
  }

  return grouped;
}

// ---------------------------------------------------------------------------
// 11. buildSkillConfigs — returns SkillConfig[] for all 7 domains
// ---------------------------------------------------------------------------

export function buildSkillConfigs(): SkillConfig[] {
  const grouped = getToolsByDomain();
  const configs: SkillConfig[] = [];

  // Sort domains for deterministic output
  const domains = Object.keys(grouped).sort();

  for (const domain of domains) {
    const tools = grouped[domain];
    const domainMeta = DOMAIN_DESCRIPTIONS[domain];

    configs.push({
      domain,
      skillName: `kai-${domain}`,
      slashCommands: tools.map((t) => t.slashCommand),
      tools: tools.map((t) => ({
        toolId: t.toolId,
        schemaExportName:
          Object.entries(SCHEMA_TO_TOOL_MAP).find(
            ([, id]) => id === t.toolId,
          )?.[0] ?? "",
        slashCommand: t.slashCommand,
        description: t.description,
      })),
      resources: DOMAIN_RESOURCES[domain] ?? [],
    });
  }

  return configs;
}
