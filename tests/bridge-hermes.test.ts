import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { HermesBridge } from "../src/bridge/hermes";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("HermesBridge", () => {
  let bridge: HermesBridge;
  let hermesDir: string;

  beforeEach(() => {
    hermesDir = join(tmpdir(), `hermes-test-${Date.now()}`);
    mkdirSync(hermesDir, { recursive: true });
    bridge = new HermesBridge(hermesDir);
  });

  afterEach(() => {
    rmSync(hermesDir, { recursive: true, force: true });
  });

  test("listCronJobs returns parsed jobs", () => {
    mkdirSync(join(hermesDir, "cron"), { recursive: true });
    writeFileSync(join(hermesDir, "cron", "jobs.json"), JSON.stringify([
      { id: "job1", name: "Morning Summary", schedule: "0 9 * * *", prompt: "Summarize yesterday", last_run: null },
    ]));
    const jobs = bridge.listCronJobs();
    expect(jobs.length).toBe(1);
    expect(jobs[0].id).toBe("job1");
  });

  test("listCronJobs returns empty array when file missing", () => {
    const jobs = bridge.listCronJobs();
    expect(jobs).toEqual([]);
  });

  test("listCronJobs returns empty array for invalid JSON", () => {
    mkdirSync(join(hermesDir, "cron"), { recursive: true });
    writeFileSync(join(hermesDir, "cron", "jobs.json"), "not json");
    const jobs = bridge.listCronJobs();
    expect(jobs).toEqual([]);
  });

  test("getCronOutput reads markdown files", () => {
    const outputDir = join(hermesDir, "cron", "output", "job1");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "2026-01-01.md"), "# Morning Summary\nAll good today.");
    const outputs = bridge.getCronOutput("job1");
    expect(outputs.length).toBe(1);
    expect(outputs[0].content).toContain("All good today");
  });

  test("getCronOutput returns empty when dir missing", () => {
    const outputs = bridge.getCronOutput("nonexistent");
    expect(outputs).toEqual([]);
  });

  test("listSkills scans SKILL.md files", () => {
    const skillDir = join(hermesDir, "skills", "dogfood");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: dogfood\n---\nQA testing skill.");
    const skills = bridge.listSkills();
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("dogfood");
  });

  test("listSkills returns empty when dir missing", () => {
    const skills = bridge.listSkills();
    expect(skills).toEqual([]);
  });

  test("getAllCronOutputs reads all jobs' outputs", () => {
    for (const jobId of ["job1", "job2"]) {
      const outputDir = join(hermesDir, "cron", "output", jobId);
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, "2026-01-01.md"), `# ${jobId} output`);
    }
    const all = bridge.getAllCronOutputs();
    expect(all.length).toBe(2);
  });
});
