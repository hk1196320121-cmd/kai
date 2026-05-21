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

describe("TournamentRunner", () => {
  let db: KaiDB;
  let store: GeneStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("tournament");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("run returns error when no eval cases exist", async () => {
    const mockLLM = createMockLLM({});
    const runner = new TournamentRunner(store, mockLLM);

    const result = await runner.run({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });

    expect(result.error).toContain("no eval cases");
    expect(result.battles_run).toBe(0);
    expect(result.tournaments).toHaveLength(0);
  });

  test("run completes tournament with mock variants and eval cases", async () => {
    const mockResponse = { winner: "a", confidence: 0.8, reasoning: "A is better" };
    const mockLLM = createMockLLM(mockResponse);

    // Create eval case
    store.createEvalCase({
      task: "planner",
      input: "Decompose: Build a CLI tool",
    });

    // Create genome for planner (seed data already has one, use it)
    const genome = store.getGenomeByTask("planner")!;
    expect(genome).not.toBeNull();

    // Create 2 variants on the planner genome
    store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "You are a helpful planner variant A.",
      generation: 1,
    });
    store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "You are a helpful planner variant B.",
      generation: 1,
    });

    const runner = new TournamentRunner(store, mockLLM);
    const result = await runner.run({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });

    expect(result.battles_run).toBeGreaterThan(0);
    expect(result.tournaments.length).toBeGreaterThan(0);
  });
});
