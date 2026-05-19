/**
 * Gap-filling tests for feat/profile-enhancements MCP layer.
 * Covers: rate limiting, scope variants, derive edge cases, corrections, safeJsonParse, etc.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMcpServer } from "../../src/mcp/server";
import { ProfileEngine } from "../../src/core/profile/engine";
import { KaiDB } from "../../src/db/client";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";
import { safeJsonParse } from "../../src/mcp/utils";
import { checkDuplicate } from "../../src/core/profile/dedup";
import { Derivator } from "../../src/core/profile/derivator";

function makeDb(): { db: KaiDB; path: string } {
  const dbPath = join(
    tmpdir(),
    `kai-mcp-gaps-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const db = new KaiDB(dbPath);
  return { db, path: dbPath };
}

function cleanupDb(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(dbPath + suffix);
    } catch {}
  }
}

function getHandler(
  db: KaiDB,
  toolName: string,
): (args: Record<string, unknown>) => Promise<any> {
  const server = createMcpServer(db);
  const registered = (server as any)._registeredTools;
  return registered[toolName].handler;
}

// ============================================================
// 1. profile.read scope variants
// ============================================================
describe("MCP handlers: profile.read scope variants", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  test("scope=identity returns parsed identity when present", async () => {
    const engine = new ProfileEngine(db);
    engine.createIdentity({
      name: "Alice",
      role: "Engineer",
      goals: '["learn rust"]',
      expertise_areas: '["typescript"]',
      learning_interests: '["ai"]',
    });

    const handler = getHandler(db, "profile.read");
    const result = await handler({ scope: "identity" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.identity).not.toBeNull();
    expect(parsed.identity.name).toBe("Alice");
    expect(parsed.identity.goals).toEqual(["learn rust"]);
    expect(parsed.identity.expertise_areas).toEqual(["typescript"]);
    expect(parsed.identity.learning_interests).toEqual(["ai"]);
  });

  test("scope=identity returns null when no identity", async () => {
    const handler = getHandler(db, "profile.read");
    const result = await handler({ scope: "identity" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.identity).toBeNull();
  });

  test("scope=full returns identity + traits + observationCount", async () => {
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Bob", role: "Dev" });
    engine.setTrait({
      dimension: "risk_tolerance",
      value: 0.8,
      confidence: 7,
      source: "observed",
      reasoning: "test",
    });
    engine.addObservation({
      type: "signal",
      key: "mcp:test:abc",
      value: '{"text":"test"}',
      confidence: 5,
      source: "mcp",
      provenance: "{}",
    });

    const handler = getHandler(db, "profile.read");
    const result = await handler({ scope: "full" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.identity).not.toBeNull();
    expect(parsed.identity.name).toBe("Bob");
    expect(parsed.traits).toHaveLength(1);
    expect(parsed.traits[0].dimension).toBe("risk_tolerance");
    expect(parsed.observationCount).toBe(1);
  });

  test("scope=traits filters by dimensions array", async () => {
    const engine = new ProfileEngine(db);
    engine.setTrait({
      dimension: "risk_tolerance",
      value: 0.8,
      confidence: 7,
      source: "observed",
      reasoning: "test",
    });
    engine.setTrait({
      dimension: "autonomy",
      value: 0.5,
      confidence: 5,
      source: "observed",
      reasoning: "test",
    });

    const handler = getHandler(db, "profile.read");
    const result = await handler({
      scope: "traits",
      dimensions: ["risk_tolerance"],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.traits).toHaveLength(1);
    expect(parsed.traits[0].dimension).toBe("risk_tolerance");
  });

  test("scope=traits returns all when no dimensions filter", async () => {
    const engine = new ProfileEngine(db);
    engine.setTrait({
      dimension: "a",
      value: 0.5,
      confidence: 5,
      source: "observed",
      reasoning: "test",
    });
    engine.setTrait({
      dimension: "b",
      value: 0.7,
      confidence: 6,
      source: "observed",
      reasoning: "test",
    });

    const handler = getHandler(db, "profile.read");
    const result = await handler({ scope: "traits" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.traits).toHaveLength(2);
  });

  test("scope=summary returns top 5 traits sorted by confidence", async () => {
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Test", role: "Dev" });
    for (let i = 0; i < 7; i++) {
      engine.setTrait({
        dimension: `trait_${i}`,
        value: 0.5,
        confidence: i + 1,
        source: "observed",
        reasoning: `reason ${i}`,
      });
    }

    const handler = getHandler(db, "profile.read");
    const result = await handler({ scope: "summary" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.topTraits).toHaveLength(5);
    // Highest confidence first
    expect(parsed.topTraits[0].confidence).toBeGreaterThanOrEqual(
      parsed.topTraits[1].confidence,
    );
  });
});

// ============================================================
// 2. profile.why with valid trait
// ============================================================
describe("MCP handlers: profile.why with valid trait", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  test("profile.why returns provenance for existing trait", async () => {
    const engine = new ProfileEngine(db);
    engine.addObservation({
      type: "behavior",
      key: "cron:morning:1",
      value: '{"hour":6}',
      confidence: 7,
      source: "cron_output",
      provenance: '{"origin_file":"test.md"}',
    });
    engine.setTrait({
      dimension: "early_riser",
      value: 0.7,
      confidence: 7,
      source: "observed",
      reasoning: "Morning activity",
    });

    const handler = getHandler(db, "profile.why");
    const result = await handler({ dimension: "early_riser" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.dimension).toBe("early_riser");
    expect(parsed.value).toBe(0.7);
    expect(parsed.provenance).toBeDefined();
    expect(parsed.provenance.method).toBe("rule");
    expect(parsed.provenance.observations.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 3. observe.submit edge cases
// ============================================================
describe("MCP handlers: observe.submit edge cases", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  test("observe.submit escapes colons in sourceTool", async () => {
    const handler = getHandler(db, "observe.submit");
    const result = await handler({
      text: "Test colon escape",
      sourceTool: "my:tool:name",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBeDefined();

    // Verify the key uses underscores
    const engine = new ProfileEngine(db);
    const obs = engine.getObservations();
    expect(obs[0].key).toContain("mcp:my_tool_name:");
  });

  test("observe.submit without confidence defaults to 5", async () => {
    const handler = getHandler(db, "observe.submit");
    const result = await handler({
      text: "No confidence",
      sourceTool: "test",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBeDefined();

    const engine = new ProfileEngine(db);
    const obs = engine.getObservations();
    expect(obs[0].confidence).toBe(5);
  });

  test("observe.submit with confidence converts from MCP scale", async () => {
    const handler = getHandler(db, "observe.submit");
    const result = await handler({
      text: "With confidence",
      sourceTool: "test",
      confidence: 0.8,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBeDefined();

    const engine = new ProfileEngine(db);
    const obs = engine.getObservations();
    // 0.8 * 9 + 1 = 8.2 → rounds to 8
    expect(obs[0].confidence).toBe(8);
  });
});

// ============================================================
// 4. Rate limiting
// ============================================================
describe("MCP handlers: rate limiting", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  test("observe.submit returns rate_limited after 60 calls", async () => {
    const handler = getHandler(db, "observe.submit");

    // Submit 60 observations
    for (let i = 0; i < 60; i++) {
      await handler({
        text: `Observation ${i}`,
        sourceTool: "rate-test",
        tags: [`unique-${i}`],
      });
    }

    // 61st should be rate limited
    const result = await handler({
      text: "Should be rate limited",
      sourceTool: "rate-test",
      tags: ["overflow"],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("rate_limited");
  });
});

// ============================================================
// 5. derive.trigger edge cases
// ============================================================
describe("MCP handlers: derive.trigger edge cases", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  test("derive.trigger method=llm returns error when no API key", async () => {
    const handler = getHandler(db, "derive.trigger");
    const result = await handler({ method: "llm" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("llm_not_configured");
  });

  test("derive.trigger method=both skips LLM when no API key (rules only)", async () => {
    const engine = new ProfileEngine(db);
    engine.addObservation({
      type: "behavior",
      key: "cron:morning:1",
      value: JSON.stringify({ hour: 6 }),
      confidence: 5,
      source: "cron_output",
      provenance: "{}",
    });

    const handler = getHandler(db, "derive.trigger");
    const result = await handler({ method: "both" });
    const parsed = JSON.parse(result.content[0].text);
    // Should still return rule-derived traits, no error
    expect(parsed.error).toBeUndefined();
    expect(parsed.derived).toBeGreaterThanOrEqual(0);
  });

  test("derive.trigger method=rules returns derived traits from observations", async () => {
    const engine = new ProfileEngine(db);
    for (let i = 0; i < 5; i++) {
      engine.addObservation({
        type: "behavior",
        key: `cron:task_${i}:hash`,
        value: JSON.stringify({ hour: 7 }),
        confidence: 5,
        source: "cron_output",
        provenance: "{}",
      });
    }

    const handler = getHandler(db, "derive.trigger");
    const result = await handler({ method: "rules" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.derived).toBeGreaterThan(0);
    expect(parsed.traits.length).toBeGreaterThan(0);
    // Check confidence is in MCP 0-1 scale
    for (const t of parsed.traits) {
      expect(t.confidence).toBeGreaterThanOrEqual(0);
      expect(t.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================
// 6. observe.batch edge cases
// ============================================================
describe("MCP handlers: observe.batch edge cases", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, path: dbPath } = makeDb());
  });

  afterEach(() => {
    db.close();
    cleanupDb(dbPath);
  });

  test("observe.batch handles duplicate among submissions", async () => {
    const handler = getHandler(db, "observe.batch");

    // First submit one to create it
    await getHandler(db, "observe.submit")({
      text: "Already here",
      sourceTool: "batch-test",
    });

    const result = await handler({
      sourceTool: "batch-test",
      observations: [
        { text: "Already here" },
        { text: "New observation" },
      ],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.submitted).toBe(1);
    expect(parsed.results).toHaveLength(2);
  });
});

// ============================================================
// 7. Engine corrections API
// ============================================================
describe("ProfileEngine corrections API", () => {
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

  test("isCorrected returns false for uncorrected dimension", () => {
    expect(engine.isCorrected("risk_tolerance")).toBe(false);
  });

  test("addCorrection and isCorrected work together", () => {
    engine.addCorrection("risk_tolerance", "Wrong value");
    expect(engine.isCorrected("risk_tolerance")).toBe(true);
    expect(engine.isCorrected("autonomy")).toBe(false);
  });

  test("getCorrections returns all corrections", () => {
    engine.addCorrection("risk_tolerance", "Wrong");
    engine.addCorrection("autonomy", "Also wrong");
    const corrections = engine.getCorrections();
    expect(corrections).toHaveLength(2);
    expect(corrections.find((c) => c.dimension === "risk_tolerance")).toBeDefined();
    expect(corrections.find((c) => c.dimension === "autonomy")).toBeDefined();
  });

  test("addCorrection replaces existing correction", () => {
    engine.addCorrection("risk_tolerance", "First reason");
    engine.addCorrection("risk_tolerance", "Updated reason");
    const corrections = engine.getCorrections();
    expect(corrections).toHaveLength(1);
    expect(corrections[0].reason).toBe("Updated reason");
  });
});

// ============================================================
// 8. Derivator skips corrected dimensions
// ============================================================
describe("Derivator skips corrected dimensions", () => {
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

  test("deriveFromRules skips corrected dimension", () => {
    // Add observations that would match early_riser
    for (let i = 0; i < 5; i++) {
      engine.addObservation({
        type: "behavior",
        key: `cron:morning:${i}`,
        value: JSON.stringify({ hour: 6 }),
        confidence: 5,
        source: "cron_output",
        provenance: "{}",
      });
    }

    // Mark early_riser as corrected
    engine.addCorrection("early_riser", "Incorrectly derived");

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const earlyRiser = results.find((t) => t.dimension === "early_riser");
    expect(earlyRiser).toBeUndefined();
  });

  test("deriveFromLLM skips corrected dimension", async () => {
    engine.addObservation({
      type: "behavior",
      key: "test:1",
      value: "{}",
      confidence: 5,
      source: "cron_output",
      provenance: "{}",
    });

    // Mark scope_appetite as corrected
    engine.addCorrection("scope_appetite", "Wrong");

    const mockProvider = {
      call: async () => ({
        traits: [
          {
            dimension: "scope_appetite",
            value: 0.8,
            confidence: 7,
            reasoning: "should be skipped",
          },
          {
            dimension: "autonomy",
            value: 0.6,
            confidence: 5,
            reasoning: "should pass",
          },
        ],
      }),
      validateWithSchema: () => {},
    } as any;

    const derivator = new Derivator(engine);
    const result = await derivator.deriveFromLLM(mockProvider);
    expect(result.find((t) => t.dimension === "scope_appetite")).toBeUndefined();
    expect(result.find((t) => t.dimension === "autonomy")).toBeDefined();
  });
});

// ============================================================
// 9. safeJsonParse utility
// ============================================================
describe("safeJsonParse", () => {
  test("parses valid JSON", () => {
    expect(safeJsonParse("[1,2,3]")).toEqual([1, 2, 3]);
  });

  test("returns fallback for invalid JSON", () => {
    expect(safeJsonParse("not json")).toEqual([]);
  });

  test("returns custom fallback", () => {
    expect(safeJsonParse("bad", null)).toBe(null);
  });

  test("parses object", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });
});
