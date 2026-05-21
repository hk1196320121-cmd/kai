import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMcpServer } from "../../../src/mcp/server";
import { KaiDB } from "../../../src/db/client";
import { tempDb, cleanup } from "../../helpers/temp-db";

describe("MCP Prompt Tool Handlers", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("mcp-prompt-handlers");
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  function getHandlers() {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    return registered;
  }

  test("prompt.compile returns compiled prompt data", async () => {
    const handlers = getHandlers();
    const result = await handlers["prompt.compile"].handler({
      task: "planner",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task).toBe("planner");
    expect(parsed.segment).toBe("default");
    expect(parsed.prompt_length).toBeGreaterThan(0);
    expect(typeof parsed.gene_count).toBe("number");
    expect(typeof parsed.cached).toBe("boolean");
  });

  test("prompt.compile returns cached on second call", async () => {
    const handlers = getHandlers();
    await handlers["prompt.compile"].handler({ task: "planner" });
    const result = await handlers["prompt.compile"].handler({
      task: "planner",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cached).toBe(true);
  });

  test("prompt.champion returns null when no champion", async () => {
    const handlers = getHandlers();
    const result = await handlers["prompt.champion"].handler({
      task: "planner",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task).toBe("planner");
    expect(parsed.segment).toBe("default");
    expect(parsed.champion).toBeNull();
  });

  test("prompt.champion returns champion when set", async () => {
    const handlers = getHandlers();
    // Set a champion via the store
    const { GeneStore } = require("../../../src/core/prompt/gene-store");
    const store = new GeneStore(db);
    const genome = store.getGenomeByTask("planner")!;
    const variant = store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Champion prompt for testing the MCP handler response.",
      generation: 1,
    });
    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: variant.id,
      model: "gpt-4o-mini",
      win_rate: 0.85,
      battle_count: 15,
      previous_variant_id: null,
    });

    // Create a new server to pick up the champion
    const server2 = createMcpServer(db);
    const handlers2 = (server2 as any)._registeredTools;
    const result = await handlers2["prompt.champion"].handler({
      task: "planner",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.champion).not.toBeNull();
    expect(parsed.champion.variant_id).toBe(variant.id);
    expect(parsed.champion.win_rate).toBe(0.85);
  });

  test("prompt.champion uses default segment when not specified", async () => {
    const handlers = getHandlers();
    const result = await handlers["prompt.champion"].handler({
      task: "derivator",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.segment).toBe("default");
  });

  test("prompt.evolve returns result structure", async () => {
    const handlers = getHandlers();
    // No eval cases, so evolve should return early
    const result = await handlers["prompt.evolve"].handler({
      task: "planner",
      rounds: 1,
      auto_approve: false,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("rounds_completed");
    expect(parsed).toHaveProperty("battles_run");
    expect(parsed).toHaveProperty("champion_promoted");
    expect(parsed).toHaveProperty("champion_variant_id");
    expect(parsed).toHaveProperty("previous_champion_variant_id");
  });
});
