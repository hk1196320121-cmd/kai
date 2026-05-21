import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { TournamentRunner } from "../../../src/core/prompt/tournament-runner";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type { LLMProvider } from "../../../src/llm/provider";

function createMockLLM(response: Record<string, unknown>): LLMProvider {
  return {
    call: async () => response,
    callWithModel: async () => response,
    buildHeaders: () => ({}),
    buildRequestBody: () => ({}),
    parseResponse: async (r: any) => r,
    validateWithSchema: () => {},
    getConfig: () => ({ apiKey: "", baseUrl: "", model: "mock" }),
  } as unknown as LLMProvider;
}

describe("TournamentRunner expanded", () => {
  let db: KaiDB;
  let store: GeneStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("tournament-expanded");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("run returns error when no genome exists for task", async () => {
    // Use a task with no seed genome (observer)
    store.createEvalCase({ task: "observer", input: "test" });
    const mockLLM = createMockLLM({});
    const runner = new TournamentRunner(store, mockLLM);
    const result = await runner.run({
      task: "observer",
      segment_id: "default",
      model: "gpt-4o-mini",
    });
    expect(result.error).toBe("no genome found");
    expect(result.battles_run).toBe(0);
  });

  test("run returns error when fewer than 2 variants exist", async () => {
    store.createEvalCase({ task: "planner", input: "test" });
    const genome = store.getGenomeByTask("planner")!;
    // Only 1 variant (the seed variant)
    const allVariants = store.listVariantsByGenome(genome.id);
    // Remove seed variant to have 0
    for (const v of allVariants) {
      db.getDatabase().run("DELETE FROM prompt_variants WHERE id = $id", { $id: v.id });
    }
    // Add exactly 1
    store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Only one variant here with enough length to be valid.",
      generation: 1,
    });

    const mockLLM = createMockLLM({});
    const runner = new TournamentRunner(store, mockLLM);
    const result = await runner.run({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });
    expect(result.error).toBe("need at least 2 variants");
    expect(result.battles_run).toBe(0);
  });

  test("run respects max_variants config to limit tournament size", async () => {
    const mockResponse = { winner: "a", confidence: 0.8, reasoning: "A wins" };
    const mockLLM = createMockLLM(mockResponse);

    store.createEvalCase({ task: "planner", input: "test input" });
    const genome = store.getGenomeByTask("planner")!;

    // Create 5 variants, but only allow 2 in tournament
    for (let i = 0; i < 5; i++) {
      store.createVariant({
        genome_id: genome.id,
        compiled_prompt: `Variant ${i} prompt with enough length to be a valid prompt for testing.`,
        generation: i + 1,
      });
    }

    const runner = new TournamentRunner(store, mockLLM);
    const result = await runner.run({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
      max_variants: 2,
    });

    // With 2 variants and 1 eval case, should be exactly 1 battle
    expect(result.battles_run).toBe(1);
    expect(result.tournaments).toHaveLength(1);
  });

  test("run respects sample_size config", async () => {
    const mockResponse = { winner: "b", confidence: 0.7, reasoning: "B wins" };
    const mockLLM = createMockLLM(mockResponse);

    // Create 5 eval cases
    for (let i = 0; i < 5; i++) {
      store.createEvalCase({ task: "planner", input: `eval ${i}` });
    }

    const genome = store.getGenomeByTask("planner")!;
    // Remove seed variant to control variant count precisely
    const existing = store.listVariantsByGenome(genome.id);
    for (const v of existing) {
      db.getDatabase().run("DELETE FROM prompt_variants WHERE id = $id", { $id: v.id });
    }

    store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Variant A with sufficient length for testing purpose.",
      generation: 1,
    });
    store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Variant B with sufficient length for testing purpose.",
      generation: 1,
    });

    const runner = new TournamentRunner(store, mockLLM);
    const result = await runner.run({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
      sample_size: 2,
    });

    // 2 variants x 2 eval cases = 4 battles (1 pair of variants, 2 cases)
    expect(result.battles_run).toBe(2);
  });

  test("run continues when judge fails for a battle", async () => {
    let callCount = 0;
    const mockLLM = {
      call: async () => {
        callCount++;
        // All calls fail (both LLM output gen and judge)
        throw new Error("LLM down");
      },
      callWithModel: async () => {
        throw new Error("LLM down");
      },
      buildHeaders: () => ({}),
      buildRequestBody: () => ({}),
      parseResponse: async (r: any) => r,
      validateWithSchema: () => {},
      getConfig: () => ({ apiKey: "", baseUrl: "", model: "mock" }),
    } as unknown as LLMProvider;

    store.createEvalCase({ task: "planner", input: "test" });
    const genome = store.getGenomeByTask("planner")!;
    store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Variant A prompt for testing the judge failure handling.",
      generation: 1,
    });
    store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Variant B prompt for testing the judge failure handling.",
      generation: 1,
    });

    const runner = new TournamentRunner(store, mockLLM);
    const result = await runner.run({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });

    // Tournament record created but battle not counted (judge failed)
    expect(result.tournaments.length).toBeGreaterThanOrEqual(1);
    expect(result.battles_run).toBe(0);
  });
});
