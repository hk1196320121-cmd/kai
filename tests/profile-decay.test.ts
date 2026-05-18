import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { DecayEngine } from "../src/core/profile/decay";
import { ProfileEngine } from "../src/core/profile/engine";
import { KaiDB } from "../src/db/client";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("DecayEngine", () => {
  let engine: ProfileEngine;
  let decay: DecayEngine;
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-decay-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    engine = new ProfileEngine(db);
    decay = new DecayEngine(engine);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("decay reduces confidence of observed traits", () => {
    engine.setTrait({ dimension: "test", value: 0.5, confidence: 8, source: "observed", reasoning: "test" });
    decay.apply();
    const traits = engine.getTraits();
    expect(traits[0].confidence).toBe(7);
  });

  test("decay does not reduce confidence below 1", () => {
    engine.setTrait({ dimension: "test", value: 0.5, confidence: 1, source: "observed", reasoning: "test" });
    decay.apply();
    const traits = engine.getTraits();
    expect(traits[0].confidence).toBe(1);
  });

  test("decay does not affect declared traits", () => {
    engine.setTrait({ dimension: "declared_test", value: 0.9, confidence: 10, source: "declared", reasoning: "user stated" });
    decay.apply();
    const traits = engine.getTraits();
    expect(traits[0].confidence).toBe(10);
  });

  test("decay returns count of decayed traits", () => {
    engine.setTrait({ dimension: "a", value: 0.5, confidence: 8, source: "observed", reasoning: "test" });
    engine.setTrait({ dimension: "b", value: 0.5, confidence: 1, source: "observed", reasoning: "test" });
    engine.setTrait({ dimension: "c", value: 0.5, confidence: 10, source: "declared", reasoning: "test" });
    const result = decay.apply();
    expect(result.decayed).toBe(1); // only 'a' was above floor
    expect(result.skipped).toBe(2); // 'b' at floor + 'c' declared
  });
});
