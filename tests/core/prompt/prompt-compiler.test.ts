import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { PromptCompiler } from "../../../src/core/prompt/prompt-compiler";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type { Trait } from "../../../src/core/profile/types";

describe("PromptCompiler", () => {
  let db: KaiDB;
  let store: GeneStore;
  let compiler: PromptCompiler;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("prompt-compiler");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
    compiler = new PromptCompiler(store);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("compile returns seeded planner prompt for empty traits", async () => {
    const result = await compiler.compile("planner", []);
    expect(result.prompt.length).toBeGreaterThan(50);
    expect(result.gene_count).toBeGreaterThanOrEqual(2);
    expect(result.segment_id).toBe("default");
    expect(result.cached).toBe(false);
  });

  test("compile returns cached result on second call", async () => {
    const r1 = await compiler.compile("planner", []);
    expect(r1.cached).toBe(false);
    const r2 = await compiler.compile("planner", []);
    expect(r2.cached).toBe(true);
    expect(r2.prompt).toBe(r1.prompt);
  });

  test("compile cache invalidates after clearCache", async () => {
    await compiler.compile("planner", []);
    compiler.clearCache();
    const result = await compiler.compile("planner", []);
    expect(result.cached).toBe(false);
  });

  test("compile validates output — no unresolved {{...}} placeholders", async () => {
    const result = await compiler.compile("planner", []);
    expect(result.prompt).not.toMatch(/\{\{.*?\}\}/);
  });

  test("compile fallback to hardcoded prompt when gene store empty for task", async () => {
    // observer has no seed genome, so it falls back to hardcoded
    const result = await compiler.compile("derivator", []);
    // Remove the genome for derivator (none seeded), should still return something
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  test("compile with profile traits passes traits to interpolation context", async () => {
    const traits: Trait[] = [
      {
        id: "t1",
        dimension: "risk_tolerance",
        value: 0.8,
        confidence: 7,
        source: "observed",
        reasoning: "test",
        updated_at: new Date().toISOString(),
      },
      {
        id: "t2",
        dimension: "autonomy",
        value: 0.5,
        confidence: 5,
        source: "declared",
        reasoning: "test",
        updated_at: new Date().toISOString(),
      },
    ];
    const result = await compiler.compile("planner", traits);
    expect(result.prompt.length).toBeGreaterThan(50);
    expect(result.segment_id).toBe("default");
  });

  test("compile uses champion variant when available", async () => {
    // Set up a champion variant
    const genome = store.createGenome({
      task: "planner",
      gene_ids: ["planner-intent-v1", "planner-contract-v1"],
    });
    const variant = store.createVariant({
      genome_id: genome.id,
      compiled_prompt:
        "Champion prompt: You are a highly optimized task decomposition engine with superior output quality.",
      generation: 2,
      mutation_type: "manual",
    });
    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: variant.id,
      model: "gpt-4o-mini",
      win_rate: 0.9,
      battle_count: 20,
      previous_variant_id: null,
    });

    compiler.clearCache();
    const result = await compiler.compile("planner", []);
    expect(result.prompt).toBe(variant.compiled_prompt);
    expect(result.variant_id).toBe(variant.id);
    expect(result.genome_id).toBe(genome.id);
  });
});
