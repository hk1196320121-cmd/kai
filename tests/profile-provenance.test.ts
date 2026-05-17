import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ProvenanceEngine } from "../src/core/profile/provenance";
import { ProfileEngine } from "../src/core/profile/engine";
import { KaiDB } from "../src/db/client";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("ProvenanceEngine", () => {
  let engine: ProfileEngine;
  let provenance: ProvenanceEngine;
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-prov-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    engine = new ProfileEngine(db);
    provenance = new ProvenanceEngine(engine);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("why returns provenance chain for trait", () => {
    engine.addObservation({
      type: "behavior", key: "cron:morning:1",
      value: '{"action": "checked cron", "hour": 6}',
      confidence: 7, source: "cron_output",
      provenance: '{"origin_file": "/hermes/cron/output/job1/2026-01-01.md", "extracted_at": "2026-01-01T09:00:00Z"}',
    });
    engine.setTrait({ dimension: "early_riser", value: 0.7, confidence: 7, source: "observed", reasoning: "Observed morning activity" });

    const chain = provenance.why("early_riser");
    expect(chain).not.toBeNull();
    expect(chain!.dimension).toBe("early_riser");
    expect(chain!.traitReasoning).toContain("morning activity");
    expect(chain!.relatedObservations.length).toBeGreaterThan(0);
    expect(chain!.relatedObservations[0].provenance).toContain("origin_file");
  });

  test("why returns null for unknown trait", () => {
    expect(provenance.why("nonexistent")).toBeNull();
  });

  test("correct removes a trait and logs correction observation", () => {
    engine.setTrait({ dimension: "bad_trait", value: 0.9, confidence: 5, source: "observed", reasoning: "mistake" });
    const result = provenance.correct("bad_trait", "This trait was incorrectly derived");
    expect(result).toBe(true);
    expect(engine.getTraits({ dimension: "bad_trait" }).length).toBe(0);
    const obs = engine.getObservations({ type: "feedback" });
    expect(obs.length).toBe(1);
    expect(obs[0].key).toBe("correction:bad_trait");
  });

  test("correct returns false for unknown trait", () => {
    expect(provenance.correct("nonexistent", "reason")).toBe(false);
  });

  test("getProvenanceChain returns observation provenance", () => {
    engine.addObservation({
      type: "behavior", key: "test:1",
      value: '{}', confidence: 5, source: "cron_output",
      provenance: '{"origin_file": "/test.md", "extracted_at": "2026-01-01T00:00:00Z", "extractor_version": "0.1.0"}',
    });
    const chain = provenance.getProvenanceChain(1);
    expect(chain).not.toBeNull();
    expect(chain!.originFile).toBe("/test.md");
    expect(chain!.extractorVersion).toBe("0.1.0");
  });
});
