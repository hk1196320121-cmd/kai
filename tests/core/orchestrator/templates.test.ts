import { describe, test, expect } from "bun:test";
import {
  TEMPLATE_CATALOG,
  matchTemplates,
  type TaskTemplate,
} from "../../../src/core/orchestrator/templates";

describe("Template Catalog", () => {
  test("has 12 templates", () => {
    expect(TEMPLATE_CATALOG.length).toBe(12);
  });

  test("every template has required fields", () => {
    for (const t of TEMPLATE_CATALOG) {
      expect(t.id).toBeDefined();
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.prompt.length).toBeGreaterThan(0);
      expect(t.domain).toBeDefined();
      expect(t.agent).toMatch(/^(hermes|openclaw|auto)$/);
      expect(typeof t.trait_targets).toBe("object");
    }
  });
});

describe("matchTemplates", () => {
  test("returns scored recommendations sorted by score descending", () => {
    const traits = [
      { dimension: "detail_oriented", value: 0.9, confidence: 8 },
      { dimension: "planning_style", value: 0.9, confidence: 8 },
      { dimension: "risk_tolerance", value: 0.5, confidence: 5 },
    ];
    const results = matchTemplates(traits, "coding");
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test("universal templates get base score 0.5", () => {
    const traits: { dimension: string; value: number; confidence: number }[] =
      [];
    const results = matchTemplates(traits, "general");
    const universals = results.filter(
      (r) => Object.keys(r.template.trait_targets).length === 0,
    );
    for (const u of universals) {
      expect(u.score).toBe(0.5);
    }
  });

  test("templates with matching domain get bonus", () => {
    const traits = [
      { dimension: "detail_oriented", value: 0.9, confidence: 8 },
    ];
    const codingResults = matchTemplates(traits, "coding");
    const codingDomains = codingResults.filter(
      (r) => r.template.domain === "coding",
    );
    expect(codingDomains.length).toBeGreaterThan(0);
  });
});
