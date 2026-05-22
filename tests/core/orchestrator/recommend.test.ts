import { describe, test, expect } from "bun:test";
import {
  recommendTasks,
  buildExplanation,
  type Recommendation,
} from "../../../src/core/orchestrator/recommend";

describe("Recommendation Engine", () => {
  const traits = [
    { dimension: "detail_oriented", value: 0.9, confidence: 8 },
    { dimension: "planning_style", value: 0.8, confidence: 7 },
    { dimension: "risk_tolerance", value: 0.3, confidence: 5 },
  ];

  test("recommendTasks returns top 3 recommendations", () => {
    const results = recommendTasks(traits, "coding");
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.explanation.length).toBeGreaterThan(0);
    }
  });

  test("recommendations include 'Why this?' explanation", () => {
    const results = recommendTasks(traits, "coding");
    for (const r of results) {
      expect(r.explanation).toBeDefined();
      expect(r.explanation.length).toBeGreaterThan(10);
    }
  });

  test("recommendations include 'Why not?' for excluded tasks", () => {
    const results = recommendTasks(traits, "coding");
    expect(results[0].whyNotOthers).toBeDefined();
    expect(results[0].whyNotOthers!.length).toBeGreaterThan(0);
  });
});

describe("buildExplanation", () => {
  test("generates explanation from matched traits", () => {
    const explanation = buildExplanation({
      template: {
        id: "test",
        title: "Test",
        description: "Test desc",
        prompt: "Test prompt",
        domain: "coding",
        agent: "hermes",
        trait_targets: {},
      },
      matchedTraits: ["detail_oriented", "planning_style"],
      score: 0.85,
    });
    expect(explanation).toContain("detail_oriented");
    expect(explanation).toContain("planning_style");
  });
});
