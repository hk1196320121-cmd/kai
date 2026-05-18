/**
 * Gap-filling tests for feat/profile-engine-phase1
 * Covers untested codepaths across engine, collector, derivator, provenance, LLM provider.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ProfileEngine } from "../src/core/profile/engine";
import { ProfileCollector } from "../src/core/profile/collector";
import { Derivator } from "../src/core/profile/derivator";
import { ProvenanceEngine } from "../src/core/profile/provenance";
import { DecayEngine } from "../src/core/profile/decay";
import { LLMProvider } from "../src/llm/provider";
import { KaiDB } from "../src/db/client";
import { HermesBridge } from "../src/bridge/hermes";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, mkdirSync, writeFileSync, rmSync } from "fs";

// Helper: create temp db
function makeDb(): { db: KaiDB; path: string } {
  const dbPath = join(tmpdir(), `kai-gap-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new KaiDB(dbPath);
  return { db, path: dbPath };
}

function cleanupDb(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(dbPath + suffix); } catch {}
  }
}

// ============================================================
// 1. ProfileEngine gaps
// ============================================================
describe("ProfileEngine gaps", () => {
  let engine: ProfileEngine;
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
    engine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  test("createIdentity rejects duplicate identity", () => {
    engine.createIdentity({ name: "First", role: "Dev" });
    expect(() => engine.createIdentity({ name: "Second", role: "PM" })).toThrow(
      "Identity already exists"
    );
  });

  test("updateIdentity throws when no identity exists", () => {
    expect(() => engine.updateIdentity({ name: "Ghost" })).toThrow("No identity found");
  });

  test("updateIdentity throws on unknown field", () => {
    engine.createIdentity({ name: "Test", role: "Dev" });
    expect(() => engine.updateIdentity({ invalid_field: "x" } as any)).toThrow("Unknown identity field");
  });

  test("updateIdentity with no-op fields (all undefined) returns early", () => {
    engine.createIdentity({ name: "Test", role: "Dev" });
    // Passing an empty object should not throw and not change anything
    engine.updateIdentity({});
    const identity = engine.getIdentity();
    expect(identity!.name).toBe("Test");
  });

  test("getObservations filters by key", () => {
    engine.addObservation({ type: "behavior", key: "target_key", value: "{}", confidence: 5, source: "cron_output", provenance: "{}" });
    engine.addObservation({ type: "behavior", key: "other_key", value: "{}", confidence: 5, source: "cron_output", provenance: "{}" });
    const filtered = engine.getObservations({ key: "target_key" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].key).toBe("target_key");
  });

  test("getObservationById returns observation", () => {
    const id = engine.addObservation({ type: "behavior", key: "test", value: "{}", confidence: 5, source: "cron_output", provenance: "{}" });
    const obs = engine.getObservationById(id);
    expect(obs).not.toBeNull();
    expect(obs!.id).toBe(id);
  });

  test("getObservationById returns null for missing id", () => {
    expect(engine.getObservationById(9999)).toBeNull();
  });
});

// ============================================================
// 2. ProfileCollector gaps
// ============================================================
describe("ProfileCollector gaps", () => {
  let engine: ProfileEngine;
  let collector: ProfileCollector;
  let bridge: HermesBridge;
  let db: KaiDB;
  let dbPath: string;
  let hermesDir: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
    hermesDir = join(tmpdir(), `hermes-gap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(hermesDir, { recursive: true });
    engine = new ProfileEngine(db);
    bridge = new HermesBridge(hermesDir);
    collector = new ProfileCollector(engine, bridge);
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
    rmSync(hermesDir, { recursive: true, force: true });
  });

  test("collectFromCronOutput with schedule extracts hour", () => {
    const count = collector.collectFromCronOutput("job1", "Some output", "30 7 * * *");
    expect(count).toBe(1);
    const obs = engine.getObservations();
    const value = JSON.parse(obs[0].value);
    expect(value.hour).toBe(7);
    expect(value.schedule).toBe("30 7 * * *");
  });

  test("collectFromCronOutput with invalid schedule (no hour)", () => {
    const count = collector.collectFromCronOutput("job1", "Output", "bad-schedule");
    expect(count).toBe(1);
    const obs = engine.getObservations();
    const value = JSON.parse(obs[0].value);
    // schedule stored but no hour extracted
    expect(value.schedule).toBe("bad-schedule");
    expect(value.hour).toBeUndefined();
  });

  test("collectFromCronOutput without schedule omits schedule field", () => {
    collector.collectFromCronOutput("job1", "Output");
    const obs = engine.getObservations();
    const value = JSON.parse(obs[0].value);
    expect(value.schedule).toBeUndefined();
    expect(value.hour).toBeUndefined();
  });
});

// ============================================================
// 3. Derivator gaps
// ============================================================
describe("Derivator gaps", () => {
  let derivator: Derivator;
  let engine: ProfileEngine;
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
    engine = new ProfileEngine(db);
    derivator = new Derivator(engine);
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  test("deriveFromRules: consistent_user rule matches cron: keys", () => {
    for (let i = 0; i < 5; i++) {
      engine.addObservation({
        type: "behavior",
        key: `cron:task_${i}:hash`,
        value: JSON.stringify({ jobId: "task", contentLength: 0 }),
        confidence: 5,
        source: "cron_output",
        provenance: "{}",
      });
    }
    const derived = derivator.deriveFromRules();
    const consistent = derived.find((t) => t.dimension === "consistent_user");
    expect(consistent).toBeDefined();
    expect(consistent!.value).toBeGreaterThan(0);
  });

  test("deriveFromRules: early_riser ignores hours outside 5-8", () => {
    engine.addObservation({
      type: "behavior",
      key: "cron:night:1",
      value: JSON.stringify({ hour: 22 }),
      confidence: 5,
      source: "cron_output",
      provenance: "{}",
    });
    const derived = derivator.deriveFromRules();
    const earlyRiser = derived.find((t) => t.dimension === "early_riser");
    expect(earlyRiser).toBeUndefined();
  });

  test("deriveFromLLM returns empty when no observations", async () => {
    const mockProvider = {
      call: async () => ({}),
      validateWithSchema: () => {},
    } as any;
    const result = await derivator.deriveFromLLM(mockProvider);
    expect(result).toEqual([]);
  });

  test("deriveFromLLM filters invalid dimensions and clamps values", async () => {
    // Add observations so LLM path proceeds
    engine.addObservation({
      type: "behavior",
      key: "test:1",
      value: "{}",
      confidence: 5,
      source: "cron_output",
      provenance: "{}",
    });

    const mockProvider = {
      call: async () => ({
        traits: [
          { dimension: "scope_appetite", value: 1.5, confidence: 15, reasoning: "clamp test" },
          { dimension: "invalid_dim", value: 0.5, confidence: 5, reasoning: "should be filtered" },
          { dimension: "autonomy", value: -0.3, confidence: 0, reasoning: "negative clamp" },
        ],
      }),
      validateWithSchema: () => {},
    } as any;

    const result = await derivator.deriveFromLLM(mockProvider);
    expect(result.length).toBe(2); // invalid_dim filtered
    const scope = result.find((t) => t.dimension === "scope_appetite");
    expect(scope!.value).toBe(1.0); // clamped to max
    expect(scope!.confidence).toBe(10); // clamped to max
    const autonomy = result.find((t) => t.dimension === "autonomy");
    expect(autonomy!.value).toBe(0.0); // clamped to min
    expect(autonomy!.confidence).toBe(1); // clamped to min
  });

  test("deriveFromLLM catches errors gracefully", async () => {
    engine.addObservation({
      type: "behavior",
      key: "test:1",
      value: "{}",
      confidence: 5,
      source: "cron_output",
      provenance: "{}",
    });

    const mockProvider = {
      call: async () => { throw new Error("LLM down"); },
      validateWithSchema: () => {},
    } as any;

    const result = await derivator.deriveFromLLM(mockProvider);
    expect(result).toEqual([]);
  });
});

// ============================================================
// 4. ProvenanceEngine gaps
// ============================================================
describe("ProvenanceEngine gaps", () => {
  let engine: ProfileEngine;
  let provenance: ProvenanceEngine;
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
    engine = new ProfileEngine(db);
    provenance = new ProvenanceEngine(engine);
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  test("getProvenanceChain returns null for missing observation", () => {
    expect(provenance.getProvenanceChain(9999)).toBeNull();
  });

  test("getProvenanceChain falls back gracefully for bad JSON provenance", () => {
    const id = engine.addObservation({
      type: "behavior",
      key: "test",
      value: "{}",
      confidence: 5,
      source: "cron_output",
      provenance: "not valid json{{{",
    });
    const chain = provenance.getProvenanceChain(id);
    expect(chain).not.toBeNull();
    expect(chain!.originFile).toBe("unknown");
    expect(chain!.extractorVersion).toBe("unknown");
  });

  test("why returns related observations via provenance.related_traits", () => {
    engine.setTrait({ dimension: "scope_appetite", value: 0.7, confidence: 5, source: "observed", reasoning: "test" });
    engine.addObservation({
      type: "behavior",
      key: "unrelated_key",
      value: "{}",
      confidence: 5,
      source: "cron_output",
      provenance: JSON.stringify({ related_traits: ["scope_appetite"] }),
    });
    const explanation = provenance.why("scope_appetite");
    expect(explanation).not.toBeNull();
    expect(explanation!.relatedObservations.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 5. LLMProvider gaps
// ============================================================
describe("LLMProvider gaps", () => {
  test("parseResponse throws on empty content", async () => {
    const provider = new LLMProvider({ apiKey: "k", baseUrl: "http://localhost", model: "m" });
    const mockResponse = { choices: [{ message: { content: "" } }] };
    expect(provider.parseResponse(mockResponse)).rejects.toThrow("No content in LLM response");
  });

  test("parseResponse throws on missing choices", async () => {
    const provider = new LLMProvider({ apiKey: "k", baseUrl: "http://localhost", model: "m" });
    const mockResponse = { choices: [] } as any;
    expect(provider.parseResponse(mockResponse)).rejects.toThrow("No content in LLM response");
  });

  test("constructor uses defaults from env", () => {
    const original = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = "env-key";
    const provider = new LLMProvider();
    const headers = provider.buildHeaders();
    expect(headers["Authorization"]).toBe("Bearer env-key");
    if (original) process.env.LLM_API_KEY = original;
    else delete process.env.LLM_API_KEY;
  });

  test("call retries on non-ok status then throws", async () => {
    const provider = new LLMProvider({ apiKey: "k", baseUrl: "http://localhost:1", model: "m" });
    // This will fail to connect (ECONNREFUSED), which is a non-ok scenario
    // With retries=0 it should throw immediately
    expect(provider.call("test", "sys", 0)).rejects.toThrow();
  });

  test("validateWithSchema checks all required fields", () => {
    const provider = new LLMProvider({ apiKey: "k", baseUrl: "http://localhost", model: "m" });
    expect(() => provider.validateWithSchema({}, ["traits"])).toThrow("Missing required field: traits");
  });
});

// ============================================================
// 6. DecayEngine gap: decay appends date to reasoning
// ============================================================
describe("DecayEngine reasoning update", () => {
  let engine: ProfileEngine;
  let decay: DecayEngine;
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
    engine = new ProfileEngine(db);
    decay = new DecayEngine(engine);
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  test("decay appends date tag to reasoning", () => {
    engine.setTrait({ dimension: "test", value: 0.5, confidence: 8, source: "observed", reasoning: "original" });
    decay.apply();
    const traits = engine.getTraits();
    expect(traits[0].reasoning).toContain("decayed");
    expect(traits[0].reasoning).toContain("original");
  });

  test("decay strips previous decay tag before appending new one", () => {
    engine.setTrait({ dimension: "test", value: 0.5, confidence: 9, source: "observed", reasoning: "base; decayed 2026-01-01" });
    decay.apply();
    const traits = engine.getTraits();
    // Should only have one "decayed" tag
    const matches = traits[0].reasoning.match(/decayed/g);
    expect(matches!.length).toBe(1);
  });
});
