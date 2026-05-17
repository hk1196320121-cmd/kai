import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { Derivator } from "../../src/core/profile/derivator";
import { ProvenanceEngine } from "../../src/core/profile/provenance";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("E2E: Bootstrap flow", () => {
  let dbPath: string;
  let db: KaiDB;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-e2e-bootstrap-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("full cold start: bootstrap -> observe -> derive -> read -> why", () => {
    const engine = new ProfileEngine(db);

    // 1. Bootstrap
    engine.createIdentity({
      name: "E2E User",
      role: "Developer",
      goals: '["build Kai"]',
      expertise_areas: '["TypeScript"]',
      learning_interests: '["Rust"]',
    });

    // 2. Add observations (simulating daily observe)
    for (let i = 0; i < 10; i++) {
      engine.addObservation({
        type: "behavior",
        key: `cron:morning_${i}`,
        value: JSON.stringify({ action: "checked cron output", hour: 6, context: "morning routine" }),
        confidence: 5,
        source: "cron_output",
        provenance: JSON.stringify({
          origin_file: `/hermes/cron/output/morning/${i}.md`,
          extracted_at: new Date().toISOString(),
          extractor_version: "0.1.0",
        }),
      });
    }

    // 3. Derive traits
    const derivator = new Derivator(engine);
    const derived = derivator.deriveFromRules();
    expect(derived.length).toBeGreaterThan(0);

    // 4. Read profile
    const snapshot = engine.getProfile();
    expect(snapshot.identity!.name).toBe("E2E User");
    expect(snapshot.observationCount).toBe(10);
    expect(snapshot.traits.length).toBeGreaterThan(0);

    // 5. Why - early_riser should be derived from the morning hour=6 observations
    const prov = new ProvenanceEngine(engine);
    const explanation = prov.why("early_riser");
    expect(explanation).not.toBeNull();
    expect(explanation!.traitValue).toBeGreaterThan(0);
  });
});
