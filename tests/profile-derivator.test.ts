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
