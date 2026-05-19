import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../src/db/client";
import { ProfileEngine } from "../src/core/profile/engine";
import { WorkspaceStore } from "../src/workspace/store";
import { computeProfileDiff } from "../src/cli/profile";

function tempDb(): string {
  return join(tmpdir(), `kai-diff-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}

describe("computeProfileDiff", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("shows trait evolution since cold start", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Cold Start" });
    const snapshotTraits = [
      { dimension: "detail_oriented", value: 0.5, confidence: 6, reasoning: "cold start" },
      { dimension: "risk_tolerance", value: 0.7, confidence: 7, reasoning: "cold start" },
    ];
    store.updateWorkspaceContext(ws.id, {
      profile_snapshot: snapshotTraits,
      coldstart_completed_at: new Date().toISOString(),
    });

    engine.setTrait({ dimension: "detail_oriented", value: 0.8, confidence: 9, source: "observed", reasoning: "12 workspace events" });
    engine.setTrait({ dimension: "risk_tolerance", value: 0.7, confidence: 8, source: "observed", reasoning: "reinforced" });
    engine.setTrait({ dimension: "comm_style", value: 0.4, confidence: 5, source: "observed", reasoning: "derived from workspace" });

    const diff = computeProfileDiff(engine, store);

    expect(diff!.workspaceName).toBe("Cold Start");
    expect(diff!.changed.length).toBe(1);
    expect(diff!.changed[0].dimension).toBe("detail_oriented");
    expect(diff!.changed[0].before.value).toBe(0.5);
    expect(diff!.changed[0].after.value).toBe(0.8);

    expect(diff!.stable.length).toBe(1);
    expect(diff!.newTraits.length).toBe(1);
    expect(diff!.newTraits[0].dimension).toBe("comm_style");

    store.close();
    db.close();
  });

  test("returns null when no workspace with snapshot found", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    const store = new WorkspaceStore(db);

    const diff = computeProfileDiff(engine, store);
    expect(diff).toBeNull();

    store.close();
    db.close();
  });
});
