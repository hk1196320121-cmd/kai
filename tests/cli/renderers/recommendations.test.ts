import { describe, test, expect, beforeEach } from "bun:test";
import { setNoColor } from "../../../src/cli/format";
import { renderRecommendations } from "../../../src/cli/renderers/recommendations";
import type { Recommendation } from "../../../src/core/orchestrator/recommend";

beforeEach(() => {
  setNoColor(true);
});

function makeRecommendation(
  overrides: Partial<Recommendation> = {},
): Recommendation {
  return {
    templateId: "t1",
    title: "Build a CLI tool",
    description: "Create a command-line app",
    score: 0.85,
    explanation: "Matches your preference for terminal workflows",
    matchedTraits: [],
    traitTargets: {},
    ...overrides,
  };
}

describe("recommendations renderer", () => {
  test("renders empty state", () => {
    const output = renderRecommendations([]);
    expect(output).toContain("No recommendations");
  });

  test("renders recommendations with scores", () => {
    const output = renderRecommendations([
      makeRecommendation({
        templateId: "t1",
        title: "Build a CLI tool",
        description: "Create a command-line app",
        score: 0.85,
        explanation: "Matches your preference for terminal workflows",
      }),
      makeRecommendation({
        templateId: "t2",
        title: "Learn Rust",
        description: "System programming",
        score: 0.72,
        explanation: "Aligns with your learning interests",
      }),
    ]);
    expect(output).toContain("Build a CLI tool");
    expect(output).toContain("85%");
    expect(output).toContain("Learn Rust");
    expect(output).toContain("72%");
  });

  test("renders Why explanation for each recommendation", () => {
    const output = renderRecommendations([
      makeRecommendation({
        title: "Build",
        description: "Desc",
        score: 0.9,
        explanation: "Great fit for your profile",
      }),
    ]);
    expect(output).toContain("Why:");
    expect(output).toContain("Great fit for your profile");
  });

  test("renders recommendation descriptions", () => {
    const output = renderRecommendations([
      makeRecommendation({
        title: "Task",
        description: "A very specific description",
        score: 0.7,
        explanation: "Ok",
      }),
    ]);
    expect(output).toContain("A very specific description");
  });

  test("renders whyNotOthers for first recommendation", () => {
    const output = renderRecommendations([
      makeRecommendation({
        templateId: "t1",
        title: "Build",
        description: "Desc",
        score: 0.9,
        explanation: "Because",
        whyNotOthers: ["A is too complex", "B lacks docs"],
      }),
    ]);
    expect(output).toContain("too complex");
    expect(output).toContain("lacks docs");
  });

  test("renders numbered list", () => {
    const output = renderRecommendations([
      makeRecommendation({ title: "First", score: 0.9, explanation: "E1" }),
      makeRecommendation({ title: "Second", score: 0.8, explanation: "E2" }),
      makeRecommendation({ title: "Third", score: 0.7, explanation: "E3" }),
    ]);
    expect(output).toContain("1.");
    expect(output).toContain("2.");
    expect(output).toContain("3.");
  });

  test("renders next steps prompt", () => {
    const output = renderRecommendations([
      makeRecommendation({ title: "A", score: 0.5, explanation: "E" }),
    ]);
    expect(output).toContain("Select");
  });

  test("renders score as percentage", () => {
    const output = renderRecommendations([
      makeRecommendation({
        title: "Scored",
        score: 0.556,
        explanation: "E",
      }),
    ]);
    // Math.round(0.556 * 100) = 56
    expect(output).toContain("56%");
  });
});
