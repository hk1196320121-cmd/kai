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
