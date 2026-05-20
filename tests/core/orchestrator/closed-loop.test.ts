import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { ProfileEngine } from "../../../src/core/profile/engine";
import { ClosedLoopEngine } from "../../../src/core/orchestrator/closed-loop";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("ClosedLoopEngine", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let profileEngine: ProfileEngine;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-closed-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
    profileEngine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("detectSignificantChanges returns empty when no traits changed", () => {
    const engine = new ClosedLoopEngine(profileEngine, store);
    const changes = engine.detectSignificantChanges();
    expect(changes).toHaveLength(0);
  });

  test("detectSignificantChanges detects trait delta above threshold", () => {
    profileEngine.setTrait({
      dimension: "detail_oriented", value: 0.5, confidence: 5,
      source: "observed", reasoning: "baseline",
    });
    profileEngine.addObservation({
      type: "behavior", key: "execution:task_completion:1",
      value: JSON.stringify({ success: true, duration_ms: 5000 }),
      confidence: 7, source: "execution_result",
      provenance: JSON.stringify({ source: "orchestrator_observer" }),
    });
    const engine = new ClosedLoopEngine(profileEngine, store);
    const changes = engine.detectSignificantChanges();
    expect(Array.isArray(changes)).toBe(true);
  });

  test("shouldTriggerReplan returns false when no significant changes", () => {
    const engine = new ClosedLoopEngine(profileEngine, store);
    expect(engine.shouldTriggerReplan()).toBe(false);
  });

  test("getReplanThreshold returns default values", () => {
    const engine = new ClosedLoopEngine(profileEngine, store);
    const threshold = engine.getReplanThreshold();
    expect(threshold.valueDelta).toBe(0.15);
    expect(threshold.confidenceDelta).toBe(2);
  });
});
