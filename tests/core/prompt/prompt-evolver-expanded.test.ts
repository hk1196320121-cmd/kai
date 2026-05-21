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

describe("PromptEvolver expanded", () => {
  let db: KaiDB;
  let store: GeneStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("evolver-expanded");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("evolve returns empty when no genome for task", async () => {
    const mockLLM = createMockLLM({});
    const evolver = new PromptEvolver(store, mockLLM);
    // observer has no seed genome
    store.createEvalCase({ task: "observer", input: "test" });

    const result = await evolver.evolve({
      task: "observer",
      segment_id: "default",
      model: "gpt-4o-mini",
    });

    expect(result.rounds_completed).toBe(0);
    expect(result.battles_run).toBe(0);
  });

  test("evolve with locked champion does not promote", async () => {
    const judgeResponse = { winner: "a", confidence: 0.9, reasoning: "A wins" };
    const mockLLM = createMockLLM(judgeResponse);

    // Set up eval cases and enough battle data
    const genome = store.getGenomeByTask("planner")!;
    for (let i = 0; i < 6; i++) {
      store.createEvalCase({ task: "planner", input: `eval ${i}` });
    }

    // Create a champion variant and lock it
    const champVariant = store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Locked champion variant with enough text for validation.",
      generation: 1,
    });

    // Remove seed variant
    const existing = store.listVariantsByGenome(genome.id);
    for (const v of existing) {
      if (v.id !== champVariant.id) {
        db.getDatabase().run("DELETE FROM prompt_variants WHERE id = $id", { $id: v.id });
      }
    }

    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: champVariant.id,
      model: "gpt-4o-mini",
      win_rate: 0.8,
      battle_count: 10,
      previous_variant_id: null,
    });
    store.lockChampion("planner", "default");

    const evolver = new PromptEvolver(store, mockLLM);
    const result = await evolver.evolve({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
      rounds: 1,
      auto_approve: true,
    });

    // Champion is locked, so promotion should fail
    expect(result.champion_promoted).toBe(false);
  });

  test("evolve with auto_approve=false does not auto-promote", async () => {
    const mockLLM = createMockLLM({
      winner: "a",
      confidence: 0.9,
      reasoning: "A wins",
    });

    store.createEvalCase({ task: "planner", input: "test eval" });
    const genome = store.getGenomeByTask("planner")!;

    // Create enough variants for a tournament
    store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "New challenger variant A with enough length for validation.",
      generation: 2,
      mutation_type: "intent_rephrase",
    });

    const evolver = new PromptEvolver(store, mockLLM);
    const result = await evolver.evolve({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
      auto_approve: false,
    });

    // Should NOT auto-promote even if win rate is high
    expect(result.champion_promoted).toBe(false);
  });

  test("generateMutation handles LLM returning .text field", async () => {
    const mockLLM = createMockLLM({
      text: "Rephrased prompt section via text field",
    });

    store.createEvalCase({ task: "planner", input: "test" });
    const evolver = new PromptEvolver(store, mockLLM);

    // Run evolve to trigger mutation
    const result = await evolver.evolve({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });

    // Should complete without error
    expect(result.rounds_completed).toBe(1);

    // Check that a variant was created with the rephrased content
    const genome = store.getGenomeByTask("planner")!;
    const variants = store.listVariantsByGenome(genome.id);
    const mutant = variants.find((v) => v.mutation_type === "intent_rephrase");
    expect(mutant).toBeDefined();
    expect(mutant!.compiled_prompt).toContain("Rephrased prompt section via text field");
  });

  test("generateMutation falls back to original when LLM fails", async () => {
    const mockLLM = createMockLLM({});
    mockLLM.call = async () => {
      throw new Error("LLM unavailable");
    };

    store.createEvalCase({ task: "planner", input: "test" });
    const evolver = new PromptEvolver(store, mockLLM);

    const result = await evolver.evolve({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });

    expect(result.rounds_completed).toBe(1);

    // The mutation should use original content as fallback
    const genome = store.getGenomeByTask("planner")!;
    const variants = store.listVariantsByGenome(genome.id);
    const mutant = variants.find((v) => v.mutation_type === "intent_rephrase");
    expect(mutant).toBeDefined();
    // Original planner-intent-v1 content should be in the compiled prompt
    expect(mutant!.compiled_prompt).toContain("task decomposition engine");
  });

  test("approvePromotion returns false when champion is locked", () => {
    const mockLLM = createMockLLM({});
    const evolver = new PromptEvolver(store, mockLLM);

    const genome = store.getGenomeByTask("planner")!;
    const variantA = store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Initial champion variant with sufficient length for validation.",
      generation: 1,
    });

    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: variantA.id,
      model: "gpt-4o-mini",
      win_rate: 0.7,
      battle_count: 5,
      previous_variant_id: null,
    });

    // Lock it
    store.lockChampion("planner", "default");

    // Try to approve a new promotion
    const variantB = store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Better variant but champion is locked so promotion fails.",
      generation: 2,
    });

    const proposal = evolver.proposePromotion("planner", "default", variantB.id, 0.9, 10);
    const result = evolver.approvePromotion(proposal);

    expect(result).toBe(false);
    // Original champion should still be in place
    const champ = store.getChampion("planner", "default");
    expect(champ!.variant_id).toBe(variantA.id);
  });
});
