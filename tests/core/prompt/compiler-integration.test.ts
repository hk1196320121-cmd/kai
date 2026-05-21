import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { Planner } from "../../../src/core/orchestrator/planner";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { PromptCompiler } from "../../../src/core/prompt/prompt-compiler";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type { Trait } from "../../../src/core/profile/types";

const VALID_LLM_RESPONSE = {
  tasks: [
    { title: "Set up project", description: "Initialize the project structure", type: "one_off", agent: "hermes", prompt: "Initialize project", decomposition_rationale: "First step" },
    { title: "Write tests", description: "Set up test framework", type: "one_off", agent: "hermes", prompt: "Set up tests", decomposition_rationale: "Validate" },
    { title: "Daily practice", description: "30 min daily coding", type: "cron", agent: "hermes", prompt: "Practice coding", cron_schedule: "0 9 * * 1-5", cron_prompt: "Practice", decomposition_rationale: "Habit" },
  ],
};

describe("Planner with PromptCompiler integration", () => {
  let db: KaiDB;
  let orchStore: OrchestratorStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("planner-compiler");
    db = new KaiDB(dbPath);
    orchStore = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("decomposeIdea uses compiled prompt when compiler provided", async () => {
    let capturedSystemPrompt = "";
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async (_prompt: string, systemPrompt: string) => {
        capturedSystemPrompt = systemPrompt;
        return VALID_LLM_RESPONSE;
      },
      validateWithSchema: () => {},
    };

    const geneStore = new GeneStore(db);
    const compiler = new PromptCompiler(geneStore);
    const planner = new Planner(orchStore, llm as any, compiler);

    const idea = orchStore.createIdea({
      title: "Test idea",
      description: "Test description",
      domain: "coding",
      priority: "high",
      workspace_id: "ws-1",
    });

    const tasks = await planner.decomposeIdea(idea.id, []);
    expect(tasks).toHaveLength(3);
    // Should contain the compiled prompt (from seed genome), not the hardcoded one
    expect(capturedSystemPrompt).toContain("task decomposition engine");
  });

  test("decomposeIdea falls back to hardcoded when compiler throws", async () => {
    let capturedSystemPrompt = "";
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async (_prompt: string, systemPrompt: string) => {
        capturedSystemPrompt = systemPrompt;
        return VALID_LLM_RESPONSE;
      },
      validateWithSchema: () => {},
    };

    // Create a compiler that will throw
    const badCompiler = {
      compile: async () => { throw new Error("DB error"); },
    };

    const planner = new Planner(orchStore, llm as any, badCompiler as any);
    const idea = orchStore.createIdea({
      title: "Test idea",
      description: "Test",
      domain: "coding",
      priority: "high",
      workspace_id: "ws-1",
    });

    const tasks = await planner.decomposeIdea(idea.id, []);
    expect(tasks).toHaveLength(3);
    // Should fall back to PLANNER_SYSTEM_PROMPT
    expect(capturedSystemPrompt).toContain("task decomposition engine");
  });

  test("decomposeIdea works without compiler (backward compatible)", async () => {
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async () => VALID_LLM_RESPONSE,
      validateWithSchema: () => {},
    };

    // No compiler passed
    const planner = new Planner(orchStore, llm as any);
    const idea = orchStore.createIdea({
      title: "Test idea",
      description: "Test",
      domain: "coding",
      priority: "high",
      workspace_id: "ws-1",
    });

    const tasks = await planner.decomposeIdea(idea.id, []);
    expect(tasks).toHaveLength(3);
  });
});

describe("Derivator with PromptCompiler integration", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("derivator-compiler");
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("deriveFromLLM uses compiled prompt when compiler provided", async () => {
    let capturedSystemPrompt = "";
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async (_prompt: string, systemPrompt: string) => {
        capturedSystemPrompt = systemPrompt;
        return {
          traits: [
            { dimension: "risk_tolerance", value: 0.5, confidence: 7, reasoning: "test" },
          ],
        };
      },
      validateWithSchema: () => {},
    };

    const { ProfileEngine } = require("../../../src/core/profile/engine");
    const { Derivator } = require("../../../src/core/profile/derivator");

    const engine = new ProfileEngine(db);
    // Add enough observations for derivation
    for (let i = 0; i < 5; i++) {
      engine.addObservation({
        type: "behavior",
        key: `test-obs-${i}`,
        value: JSON.stringify({ action: "test" }),
        confidence: 7,
        source: "mcp",
        provenance: "{}",
      });
    }

    const derivator = new Derivator(engine);
    const geneStore = new GeneStore(db);
    const compiler = new PromptCompiler(geneStore);

    const results = await derivator.deriveFromLLM(llm as any, compiler);
    // Should have used compiled prompt from seed derivator genome
    expect(capturedSystemPrompt).toContain("user profile analysis engine");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].dimension).toBe("risk_tolerance");
  });

  test("deriveFromLLM falls back when compiler throws", async () => {
    let capturedSystemPrompt = "";
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async (_prompt: string, systemPrompt: string) => {
        capturedSystemPrompt = systemPrompt;
        return {
          traits: [
            { dimension: "autonomy", value: 0.7, confidence: 8, reasoning: "fallback test" },
          ],
        };
      },
      validateWithSchema: () => {},
    };

    const { ProfileEngine } = require("../../../src/core/profile/engine");
    const { Derivator } = require("../../../src/core/profile/derivator");

    const engine = new ProfileEngine(db);
    for (let i = 0; i < 5; i++) {
      engine.addObservation({
        type: "behavior",
        key: `test-obs-${i}`,
        value: JSON.stringify({ action: "test" }),
        confidence: 7,
        source: "mcp",
        provenance: "{}",
      });
    }

    const derivator = new Derivator(engine);
    const badCompiler = {
      compile: async () => { throw new Error("Compile error"); },
    };

    const results = await derivator.deriveFromLLM(llm as any, badCompiler as any);
    expect(capturedSystemPrompt).toContain("user profile analysis engine");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("deriveFromLLM works without compiler (backward compatible)", async () => {
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async () => ({
        traits: [
          { dimension: "scope_appetite", value: 0.6, confidence: 6, reasoning: "test" },
        ],
      }),
      validateWithSchema: () => {},
    };

    const { ProfileEngine } = require("../../../src/core/profile/engine");
    const { Derivator } = require("../../../src/core/profile/derivator");

    const engine = new ProfileEngine(db);
    for (let i = 0; i < 5; i++) {
      engine.addObservation({
        type: "behavior",
        key: `test-obs-${i}`,
        value: JSON.stringify({ action: "test" }),
        confidence: 7,
        source: "mcp",
        provenance: "{}",
      });
    }

    const derivator = new Derivator(engine);
    const results = await derivator.deriveFromLLM(llm as any);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].dimension).toBe("scope_appetite");
  });
});
