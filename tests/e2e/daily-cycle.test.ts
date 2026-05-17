import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { ProfileCollector } from "../../src/core/profile/collector";
import { HermesBridge } from "../../src/bridge/hermes";
import { Derivator } from "../../src/core/profile/derivator";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, mkdirSync, writeFileSync, rmSync } from "fs";

describe("E2E: Daily cycle", () => {
  let dbPath: string;
  let db: KaiDB;
  let hermesDir: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-e2e-daily-${Date.now()}.db`);
    hermesDir = join(tmpdir(), `hermes-e2e-daily-${Date.now()}`);
    mkdirSync(hermesDir, { recursive: true });
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
    rmSync(hermesDir, { recursive: true, force: true });
  });

  test("hermes cron output -> daily observe -> derive -> traits updated", () => {
    const outputDir = join(hermesDir, "cron", "output", "morning");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "2026-05-18.md"), "# Morning Summary\nAll systems operational.");

    const engine = new ProfileEngine(db);
    const bridge = new HermesBridge(hermesDir);
    const collector = new ProfileCollector(engine, bridge);

    const count = collector.collectDaily();
    expect(count).toBeGreaterThan(0);

    const derivator = new Derivator(engine);
    derivator.deriveFromRules();

    const snapshot = engine.getProfile();
    expect(snapshot.observationCount).toBeGreaterThan(0);
    expect(snapshot.traits.length).toBeGreaterThan(0);
  });
});
