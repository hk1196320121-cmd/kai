import { describe, test, expect } from "bun:test";
import type { WorkflowDefinition } from "../../../../src/cli/skills/workflows/types";

describe("WorkflowDefinition schema", () => {
  test("valid workflow definition has required fields", () => {
    const wf: WorkflowDefinition = {
      name: "kai",
      description: "Dashboard",
      tools: [{ id: "profile.read", params: { scope: "summary" } }],
      profileConditions: [],
      emptyProfileFallback: "Welcome!",
    };
    expect(wf.name).toBe("kai");
    expect(wf.tools).toHaveLength(1);
    expect(wf.tools[0].id).toBe("profile.read");
  });

  test("profile condition has trait, threshold, and include", () => {
    const condition = {
      trait: "early_riser",
      threshold: 0.7,
      include: "## Peak Focus Time\nYour morning window is optimal.",
    };
    expect(condition.trait).toBe("early_riser");
    expect(condition.threshold).toBeGreaterThan(0);
    expect(condition.include.length).toBeGreaterThan(0);
  });

  test("workflow without profile conditions is valid", () => {
    const wf: WorkflowDefinition = {
      name: "kai-why",
      description: "Why",
      tools: [{ id: "profile.why" }],
      profileConditions: [],
    };
    expect(wf.profileConditions).toHaveLength(0);
  });
});

import { getBakedTraits, PII_WHITELIST } from "../../../../src/cli/skills/commands/profile-aware";

describe("profile-aware trait baking", () => {
  test("PII whitelist contains only behavioral dimensions", () => {
    expect(PII_WHITELIST).toContain("early_riser");
    expect(PII_WHITELIST).toContain("tinkerer");
    expect(PII_WHITELIST).toContain("risk_tolerance");
    expect(PII_WHITELIST).toContain("detail_oriented");
    expect(PII_WHITELIST).toContain("planning_style");
    // Identity fields must NOT be in whitelist
    expect(PII_WHITELIST).not.toContain("name");
    expect(PII_WHITELIST).not.toContain("role");
    expect(PII_WHITELIST).not.toContain("email");
  });

  test("getBakedTraits returns empty map when no profile", () => {
    const traits = getBakedTraits(null);
    expect(traits.size).toBe(0);
  });

  test("getBakedTraits filters to whitelist only", () => {
    const mockTraits = [
      { dimension: "early_riser", value: 0.9, confidence: 8, source: "observed" as const, reasoning: "test", id: "1", updated_at: "" },
      { dimension: "name", value: 0, confidence: 0, source: "declared" as const, reasoning: "PII", id: "2", updated_at: "" },
    ];
    const traits = getBakedTraits({ identity: null, traits: mockTraits, preferences: [], observationCount: 5, recentObservations: [] });
    expect(traits.size).toBe(1);
    expect(traits.get("early_riser")).toBe(0.9);
    expect(traits.has("name")).toBe(false);
  });

  test("getBakedTraits returns map of dimension to value", () => {
    const mockTraits = [
      { dimension: "early_riser", value: 0.85, confidence: 7, source: "observed" as const, reasoning: "", id: "1", updated_at: "" },
      { dimension: "tinkerer", value: 0.6, confidence: 5, source: "inferred" as const, reasoning: "", id: "2", updated_at: "" },
    ];
    const traits = getBakedTraits({ identity: null, traits: mockTraits, preferences: [], observationCount: 10, recentObservations: [] });
    expect(traits.get("early_riser")).toBe(0.85);
    expect(traits.get("tinkerer")).toBe(0.6);
  });
});

import { WORKFLOWS } from "../../../../src/cli/skills/workflows/definitions";

describe("workflow definitions", () => {
  test("exports exactly 8 workflows", () => {
    expect(WORKFLOWS).toHaveLength(8);
  });

  test("every workflow has a unique name", () => {
    const names = WORKFLOWS.map((w) => w.name);
    expect(new Set(names).size).toBe(8);
  });

  test("every workflow name starts with kai", () => {
    for (const wf of WORKFLOWS) {
      expect(wf.name).toMatch(/^kai/);
    }
  });

  test("every workflow has at least one tool", () => {
    for (const wf of WORKFLOWS) {
      expect(wf.tools.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("every tool id references a known MCP tool", () => {
    const knownTools = new Set([
      "profile.read", "profile.why",
      "observe.submit", "observe.batch",
      "derive.trigger",
      "kai_work_recommend", "kai_execution_status",
      "kai_idea_submit", "kai_idea_plan",
      "prompt.compile", "prompt.evolve",
      "telemetry.query",
    ]);
    for (const wf of WORKFLOWS) {
      for (const tool of wf.tools) {
        expect(knownTools.has(tool.id), `Unknown tool: ${tool.id} in ${wf.name}`).toBe(true);
      }
    }
  });

  test("dashboard workflow (/kai) composes profile.read + kai_work_recommend", () => {
    const dashboard = WORKFLOWS.find((w) => w.name === "kai")!;
    expect(dashboard).toBeDefined();
    const toolIds = dashboard.tools.map((t) => t.id);
    expect(toolIds).toContain("profile.read");
    expect(toolIds).toContain("kai_work_recommend");
  });

  test("profile workflow has early_riser condition", () => {
    const profile = WORKFLOWS.find((w) => w.name === "kai-profile")!;
    expect(profile.profileConditions.some((c) => c.trait === "early_riser")).toBe(true);
  });

  test("every workflow with profileConditions has an emptyProfileFallback", () => {
    for (const wf of WORKFLOWS) {
      if (wf.profileConditions.length > 0) {
        expect(wf.emptyProfileFallback, `${wf.name} has conditions but no fallback`).toBeDefined();
      }
    }
  });
});
