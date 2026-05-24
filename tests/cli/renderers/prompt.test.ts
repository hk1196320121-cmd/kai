import { describe, test, expect, beforeEach } from "bun:test";
import { setNoColor } from "../../../src/cli/format";
import {
  renderChampion,
  renderGeneList,
  renderTournamentResults,
} from "../../../src/cli/renderers/prompt";
import type {
  PromptChampion,
  PromptGene,
  PromptTournament,
} from "../../../src/core/prompt/types";

beforeEach(() => {
  setNoColor(true);
});

function makeChampion(
  overrides: Partial<PromptChampion> = {},
): PromptChampion {
  return {
    id: "ch-1",
    task: "planner",
    segment_id: "seg-1",
    variant_id: "var-abc12345",
    model: "claude-sonnet-4-6",
    win_rate: 0.78,
    battle_count: 50,
    promoted_at: "2024-01-15T00:00:00Z",
    previous_variant_id: null,
    is_locked: 0,
    ...overrides,
  };
}

function makeGene(overrides: Partial<PromptGene> = {}): PromptGene {
  return {
    id: "gene-abc12345678",
    task: "planner",
    type: "intent",
    content: "You are a helpful task planner",
    trait_bindings: "{}",
    metadata: "{}",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTournament(
  overrides: Partial<PromptTournament> = {},
): PromptTournament {
  return {
    id: "tour-12345678",
    task: "planner",
    variant_a_id: "var-aaa11111",
    variant_b_id: "var-bbb22222",
    eval_case_id: "eval-1",
    segment_id: null,
    model: "gpt-4o-mini",
    winner: "a",
    judge_reasoning: "A was better",
    judge_confidence: 0.85,
    judged_at: "2024-01-15T00:00:00Z",
    created_at: "2024-01-15T00:00:00Z",
    ...overrides,
  };
}

describe("prompt renderer", () => {
  describe("renderChampion", () => {
    test("renders unlocked champion", () => {
      const output = renderChampion(makeChampion());
      expect(output).toContain("planner");
      expect(output).toContain("78.0%");
      expect(output).toContain("50");
    });

    test("renders locked champion", () => {
      const output = renderChampion(makeChampion({ is_locked: 1 }));
      expect(output).toContain("LOCKED");
    });

    test("renders champion model", () => {
      const output = renderChampion(
        makeChampion({ model: "gpt-4o" }),
      );
      expect(output).toContain("gpt-4o");
    });

    test("renders champion variant id (truncated)", () => {
      const output = renderChampion(
        makeChampion({ variant_id: "var-abcdefghij" }),
      );
      expect(output).toContain("var-abc");
    });

    test("renders champion promoted date", () => {
      const output = renderChampion(
        makeChampion({ promoted_at: "2024-06-20T12:00:00Z" }),
      );
      expect(output).toContain("2024-06-20");
    });

    test("renders champion win rate at different values", () => {
      const output = renderChampion(makeChampion({ win_rate: 0.625 }));
      expect(output).toContain("62.5%");
    });

    test("renders champion segment id", () => {
      const output = renderChampion(
        makeChampion({ segment_id: "seg-special" }),
      );
      expect(output).toContain("seg-special");
    });
  });

  describe("renderGeneList", () => {
    test("renders empty state", () => {
      const output = renderGeneList([]);
      expect(output).toContain("No genes found");
    });

    test("renders gene list with task and type", () => {
      const output = renderGeneList([
        makeGene({
          id: "gene-abc12345678",
          task: "planner",
          type: "intent",
        }),
      ]);
      expect(output).toContain("planner");
      expect(output).toContain("intent");
    });

    test("renders gene id truncated", () => {
      const output = renderGeneList([
        makeGene({ id: "gene-longidentifier123" }),
      ]);
      // id.slice(0, 8) = "gene-lon"
      expect(output).toContain("gene-lon");
    });

    test("renders gene content (truncated if long)", () => {
      const longContent = "A".repeat(60);
      const output = renderGeneList([
        makeGene({ content: longContent }),
      ]);
      // Content > 50 chars is truncated to 47 + "..."
      expect(output).toContain("...");
    });

    test("renders short gene content in full", () => {
      const output = renderGeneList([
        makeGene({ content: "Short prompt" }),
      ]);
      expect(output).toContain("Short prompt");
    });

    test("renders multiple genes", () => {
      const output = renderGeneList([
        makeGene({ id: "gene-111111111111", task: "planner", type: "intent" }),
        makeGene({ id: "gene-222222222222", task: "derivator", type: "contract" }),
      ]);
      expect(output).toContain("planner");
      expect(output).toContain("derivator");
      expect(output).toContain("intent");
      expect(output).toContain("contract");
    });
  });

  describe("renderTournamentResults", () => {
    test("renders empty state", () => {
      const output = renderTournamentResults([]);
      expect(output).toContain("No tournament results");
    });

    test("renders tournament with winner A", () => {
      const output = renderTournamentResults([
        makeTournament({
          variant_a_id: "var-aaa11111",
          variant_b_id: "var-bbb22222",
          winner: "a",
        }),
      ]);
      // Renderer truncates variant ids to 8 chars
      expect(output).toContain("var-aaa1");
      expect(output).toContain("var-bbb2");
      expect(output).toContain("A (var-aaa1)");
    });

    test("renders tournament with winner B", () => {
      const output = renderTournamentResults([
        makeTournament({
          variant_a_id: "var-xxx11111",
          variant_b_id: "var-yyy22222",
          winner: "b",
        }),
      ]);
      // Renderer truncates variant ids to 8 chars
      expect(output).toContain("var-xxx1");
      expect(output).toContain("var-yyy2");
      expect(output).toContain("B (var-yyy2)");
    });

    test("renders tournament with tie", () => {
      const output = renderTournamentResults([
        makeTournament({
          variant_a_id: "var-tie11111",
          variant_b_id: "var-tie22222",
          winner: "tie",
        }),
      ]);
      expect(output).toContain("Tie");
    });

    test("renders tournament with null winner (pending)", () => {
      const output = renderTournamentResults([
        makeTournament({
          variant_a_id: "var-pnd11111",
          variant_b_id: "var-pnd22222",
          winner: null,
        }),
      ]);
      expect(output).toContain("Pending");
    });

    test("renders judge confidence", () => {
      const output = renderTournamentResults([
        makeTournament({ judge_confidence: 0.85 }),
      ]);
      expect(output).toContain("0.85");
    });

    test("renders tournament with null confidence", () => {
      const output = renderTournamentResults([
        makeTournament({ judge_confidence: null }),
      ]);
      expect(output).toContain("N/A");
    });

    test("renders tournament id truncated", () => {
      const output = renderTournamentResults([
        makeTournament({ id: "tour-abcdefghij" }),
      ]);
      expect(output).toContain("tour-abc");
    });

    test("renders tournament created date", () => {
      const output = renderTournamentResults([
        makeTournament({ created_at: "2024-07-20T15:30:00Z" }),
      ]);
      expect(output).toContain("2024-07-20");
    });
  });
});
