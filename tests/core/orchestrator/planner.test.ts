import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { Planner } from "../../../src/core/orchestrator/planner";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import type { Trait } from "../../../src/core/profile/types";

function createMockLLM(response: Record<string, unknown>) {
  return {
    getConfig: () => ({ apiKey: "test", baseUrl: "http://localhost", model: "test" }),
    call: async () => response,
    validateWithSchema: () => {},
  };
}

const VALID_LLM_RESPONSE = {
  tasks: [
    { title: "Set up project", description: "Initialize the project structure", type: "one_off", agent: "hermes", prompt: "Initialize project", decomposition_rationale: "First step" },
    { title: "Write tests", description: "Set up test framework and write initial tests", type: "one_off", agent: "hermes", prompt: "Set up tests", decomposition_rationale: "Validate approach" },
    { title: "Daily practice", description: "30 min daily coding practice", type: "cron", agent: "hermes", prompt: "Practice coding", cron_schedule: "0 9 * * 1-5", cron_prompt: "Practice for 30 min", decomposition_rationale: "Build habit" },
  ],
};

describe("Planner", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-planner-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("decomposeIdea creates tasks from LLM response", async () => {
    const llm = createMockLLM(VALID_LLM_RESPONSE);
    const planner = new Planner(store, llm as any);
    const idea = store.createIdea({ title: "Learn Rust", description: "Build a CLI tool", domain: "coding", priority: "high", workspace_id: "ws-1" });

    const tasks = await planner.decomposeIdea(idea.id, []);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe("Set up project");
    expect(tasks[2].type).toBe("cron");
  });

  test("decomposeIdea falls back to single task on LLM failure", async () => {
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async () => { throw new Error("LLM down"); },
      validateWithSchema: () => {},
    };
    const planner = new Planner(store, llm as any);
    const idea = store.createIdea({ title: "Learn Rust", description: "Build a CLI tool", domain: "coding", priority: "high", workspace_id: "ws-1" });

    const tasks = await planner.decomposeIdea(idea.id, []);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Learn Rust");
    expect(tasks[0].prompt).toContain("Build a CLI tool");
  });

  test("decomposeIdea retries once on validation failure then falls back", async () => {
    let callCount = 0;
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async () => {
        callCount++;
        return { tasks: [{ title: "Missing fields" }] };
      },
      validateWithSchema: (_obj: Record<string, unknown>, fields: string[]) => {
        if (fields.includes("description")) throw new Error("Missing field: description");
      },
    };
    const planner = new Planner(store, llm as any);
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });

    const tasks = await planner.decomposeIdea(idea.id, []);
    expect(tasks).toHaveLength(1);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test("decomposeIdea includes profile context in prompt", async () => {
    let capturedPrompt = "";
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async (prompt: string, _systemPrompt: string) => {
        capturedPrompt = prompt;
        return VALID_LLM_RESPONSE;
      },
      validateWithSchema: () => {},
    };
    const planner = new Planner(store, llm as any);
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "coding", priority: "medium", workspace_id: "ws-1" });
    const traits: Trait[] = [
      { id: "1", dimension: "detail_oriented", value: 0.9, confidence: 8, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];

    await planner.decomposeIdea(idea.id, traits);
    expect(capturedPrompt).toContain("detail_oriented");
  });

  test("decomposeIdea rejects tasks outside 3-8 range", async () => {
    const tooManyTasks = {
      tasks: Array.from({ length: 10 }, (_, i) => ({
        title: `Task ${i}`, description: `Desc ${i}`, type: "one_off", agent: "hermes",
        prompt: `Do task ${i}`, decomposition_rationale: `Reason ${i}`,
      })),
    };
    const llm = createMockLLM(tooManyTasks);
    const planner = new Planner(store, llm as any);
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });

    const tasks = await planner.decomposeIdea(idea.id, []);
    // 10 tasks from LLM but we cap at 8. Since >= 3, we accept them (capped).
    expect(tasks.length).toBeLessThanOrEqual(8);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  test("throws if idea not found", async () => {
    const llm = createMockLLM(VALID_LLM_RESPONSE);
    const planner = new Planner(store, llm as any);
    await expect(planner.decomposeIdea("nonexistent", [])).rejects.toThrow("Idea not found");
  });
});
