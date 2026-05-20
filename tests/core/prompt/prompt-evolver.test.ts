import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { PromptEvolver } from "../../../src/core/prompt/prompt-evolver";
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

describe("PromptEvolver", () => {
  let db: KaiDB;
  let store: GeneStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("evolver");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("evolve returns empty result when no eval cases", async () => {
    const mockLLM = createMockLLM({});
    const evolver = new PromptEvolver(store, mockLLM);

    const result = await evolver.evolve({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });

    expect(result.rounds_completed).toBe(0);
    expect(result.battles_run).toBe(0);
    expect(result.champion_promoted).toBe(false);
    expect(result.champion_variant_id).toBeNull();
    expect(result.previous_champion_variant_id).toBeNull();
  });

  test("evolve generates mutant variants", async () => {
    const mockResponse = { winner: "a", confidence: 0.8, reasoning: "A is better" };
    const mockLLM = createMockLLM(mockResponse);

    // Seed an eval case so evolve can proceed
    store.createEvalCase({
      task: "planner",
      input: "Decompose: Build a CLI tool",
    });

    const evolver = new PromptEvolver(store, mockLLM);
    const result = await evolver.evolve({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });

    expect(result.rounds_completed).toBe(1);
    expect(result.battles_run).toBeGreaterThanOrEqual(0);
  });

  test("proposePromotion requires approval by default", () => {
    const mockLLM = createMockLLM({});
    const evolver = new PromptEvolver(store, mockLLM);

    // Set existing champion
    const genome = store.getGenomeByTask("planner")!;
    store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Original champion prompt",
      generation: 1,
    });

    const variants = store.listVariantsByGenome(genome.id);
    // Use the seed variant as the existing champion
    const seedVariant = variants[0];

    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: seedVariant.id,
      model: "gpt-4o-mini",
      win_rate: 0.7,
      battle_count: 10,
      previous_variant_id: null,
    });

    // Create a new variant and propose promotion
    const newVariant = store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Improved mutant prompt",
      generation: 2,
      mutation_type: "intent_rephrase",
    });

    const proposal = evolver.proposePromotion(
      "planner",
      "default",
      newVariant.id,
      0.85,
      12,
    );

    expect(proposal.needs_approval).toBe(true);
    expect(proposal.variant_id).toBe(newVariant.id);
    expect(proposal.win_rate).toBe(0.85);
    expect(proposal.battle_count).toBe(12);
    expect(proposal.task).toBe("planner");
    expect(proposal.segment_id).toBe("default");
  });

  test("approvePromotion applies the champion change", () => {
    const mockLLM = createMockLLM({});
    const evolver = new PromptEvolver(store, mockLLM);

    const genome = store.getGenomeByTask("planner")!;

    // Create variant A as initial champion
    const variantA = store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Champion A prompt",
      generation: 1,
    });

    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: variantA.id,
      model: "gpt-4o-mini",
      win_rate: 0.7,
      battle_count: 10,
      previous_variant_id: null,
    });

    // Verify initial champion
    const initialChampion = store.getChampion("planner", "default", "gpt-4o-mini");
    expect(initialChampion).not.toBeNull();
    expect(initialChampion!.variant_id).toBe(variantA.id);

    // Create variant B and propose/approve promotion
    const variantB = store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Champion B prompt - improved",
      generation: 2,
      mutation_type: "contract_adjust",
    });

    const proposal = evolver.proposePromotion(
      "planner",
      "default",
      variantB.id,
      0.9,
      15,
    );

    evolver.approvePromotion(proposal);

    // Verify new champion
    const newChampion = store.getChampion("planner", "default", "gpt-4o-mini");
    expect(newChampion).not.toBeNull();
    expect(newChampion!.variant_id).toBe(variantB.id);
    expect(newChampion!.previous_variant_id).toBe(variantA.id);
  });
});
