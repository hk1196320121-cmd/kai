import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ProfileCollector } from "../src/core/profile/collector";
import { ProfileEngine } from "../src/core/profile/engine";
import { KaiDB } from "../src/db/client";
import { HermesBridge } from "../src/bridge/hermes";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";

describe("ProfileCollector", () => {
  let engine: ProfileEngine;
  let collector: ProfileCollector;
  let bridge: HermesBridge;
  let db: KaiDB;
  let dbPath: string;
  let hermesDir: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-collector-test-${Date.now()}.db`);
    hermesDir = join(tmpdir(), `hermes-collector-test-${Date.now()}`);
    mkdirSync(hermesDir, { recursive: true });
    db = new KaiDB(dbPath);
    engine = new ProfileEngine(db);
    bridge = new HermesBridge(hermesDir);
    collector = new ProfileCollector(engine, bridge);
  });

  afterEach(() => {
    db.close();
    rmSync(hermesDir, { recursive: true, force: true });
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("collectFromCronOutput extracts observations from markdown", () => {
    const count = collector.collectFromCronOutput("job1", "# Summary\nDeployed v2.0 successfully.");
    expect(count).toBeGreaterThan(0);
    const obs = engine.getObservations();
    expect(obs.length).toBe(count);
    expect(obs[0].source).toBe("cron_output");
    expect(obs[0].provenance).toContain("job1");
  });

  test("collectDaily reads all cron outputs", () => {
    for (const jobId of ["job1", "job2"]) {
      const outputDir = join(hermesDir, "cron", "output", jobId);
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, "2026-01-01.md"), `# ${jobId}\nOutput content.`);
    }
    const count = collector.collectDaily();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("collectDaily returns 0 when hermes dir missing", () => {
    const badBridge = new HermesBridge(join(tmpdir(), "nonexistent"));
    const badCollector = new ProfileCollector(engine, badBridge);
    expect(badCollector.collectDaily()).toBe(0);
  });

  test("collectFromCronOutput skips already-processed content", () => {
    const outputDir = join(hermesDir, "cron", "output", "job1");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "2026-01-01.md"), "# Same content\nIdentical.");

    const count1 = collector.collectFromCronOutput("job1", "# Same content\nIdentical.");
    const count2 = collector.collectFromCronOutput("job1", "# Same content\nIdentical.");
    expect(count1).toBeGreaterThan(0);
    expect(count2).toBe(0); // deduped
  });
});
