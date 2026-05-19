import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Derivator } from "../src/core/profile/derivator";
import { ProfileEngine } from "../src/core/profile/engine";
import { KaiDB } from "../src/db/client";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("Derivator", () => {
  let derivator: Derivator;
  let engine: ProfileEngine;
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-derive-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    engine = new ProfileEngine(db);
    derivator = new Derivator(engine);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  describe("Rule-based derivation", () => {
    test("derives early_riser from morning cron observations", () => {
      for (let i = 0; i < 10; i++) {
        engine.addObservation({
          type: "behavior",
          key: `cron:morning_check:${i}`,
          value: JSON.stringify({ action: "checked cron output", hour: 6, context: "morning routine" }),
          confidence: 5,
          source: "cron_output",
          provenance: '{}',
        });
      }
      const derived = derivator.deriveFromRules();
      const earlyRiser = derived.find((t) => t.dimension === "early_riser");
      expect(earlyRiser).toBeDefined();
      expect(earlyRiser!.value).toBeGreaterThan(0.5);
    });

    test("derives tinkerer from distinct cron output entries", () => {
      for (let i = 0; i < 8; i++) {
        engine.addObservation({
          type: "behavior",
          key: `cron:daily_summary:hash${i}`,
          value: JSON.stringify({ jobId: "daily_summary", contentPreview: `output ${i}`, contentLength: 100 + i }),
          confidence: 6,
          source: "cron_output",
          provenance: '{}',
        });
      }
      const derived = derivator.deriveFromRules();
      const tinkerer = derived.find((t) => t.dimension === "tinkerer");
      expect(tinkerer).toBeDefined();
      expect(tinkerer!.value).toBeGreaterThan(0.3);
    });

    test("returns empty when no observations", () => {
      const derived = derivator.deriveFromRules();
      expect(derived).toEqual([]);
    });

    test("deriveFromRules writes traits to engine", () => {
      engine.addObservation({
        type: "behavior", key: "cron:morning:1",
        value: JSON.stringify({ action: "checked cron output", hour: 6 }),
        confidence: 5, source: "cron_output", provenance: '{}',
      });
      derivator.deriveFromRules();
      const traits = engine.getTraits();
      expect(traits.length).toBeGreaterThan(0);
    });
  });
});

describe("Derivator with MCP observations", () => {
  let engine: ProfileEngine;
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-derive-mcp-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    engine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("derives detail_oriented from MCP observations with detail-related text", () => {
    engine.addObservation({
      type: "signal",
      key: "mcp:cursor:abc123",
      value: JSON.stringify({ text: "User asks for detailed explanations of every code change" }),
      confidence: 8,
      source: "mcp",
      provenance: JSON.stringify({ source_tool: "cursor", submitted_via: "mcp" }),
    });
    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const detail = results.find((t) => t.dimension === "detail_oriented");
    expect(detail).toBeDefined();
    expect(detail!.value).toBeGreaterThan(0);
  });

  test("derives scope_appetite from MCP observations with scope-related text", () => {
    engine.addObservation({
      type: "signal",
      key: "mcp:claude-code:def456",
      value: JSON.stringify({ text: "User wants to take on ambitious large-scale projects" }),
      confidence: 7,
      source: "mcp",
      provenance: JSON.stringify({ source_tool: "claude-code" }),
    });
    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const scope = results.find((t) => t.dimension === "scope_appetite");
    expect(scope).toBeDefined();
  });

  test("derives risk_tolerance from MCP observations with risk-related text", () => {
    engine.addObservation({
      type: "signal",
      key: "mcp:hermes:ghi789",
      value: JSON.stringify({ text: "User likes to experiment with cutting edge technologies" }),
      confidence: 6,
      source: "mcp",
      provenance: JSON.stringify({ source_tool: "hermes" }),
    });
    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const risk = results.find((t) => t.dimension === "risk_tolerance");
    expect(risk).toBeDefined();
  });
});
