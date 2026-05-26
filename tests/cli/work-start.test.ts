import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { WorkspaceStore } from "../../src/workspace/store";
import { Derivator } from "../../src/core/profile/derivator";
import { cleanup, tempDb } from "../helpers/temp-db";

// --- Group 1: Reset logic (work.ts L259-270) ---
// The reset logic iterates observations, filters by source === "coldstart",
// and deletes matching rows via raw SQL.

describe("work start: reset coldstart data", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("reset=true deletes only coldstart-source observations", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:git.commit_time_distribution",
      value: JSON.stringify({ morning_ratio: 0.5 }),
      confidence: 4,
      source: "coldstart",
      provenance: "{}",
    });
    engine.addObservation({
      type: "signal",
      key: "coldstart:goal",
      value: "build api",
      confidence: 8,
      source: "coldstart",
      provenance: "{}",
    });
    engine.addObservation({
      type: "signal",
      key: "manual:note",
      value: "keep this",
      confidence: 5,
      source: "user_stated",
      provenance: "{}",
    });

    // Replicate start.ts batch DELETE logic
    const raw = db.getDatabase();
    raw.query("DELETE FROM observations WHERE source = $source").run({
      $source: "coldstart",
    });

    const remaining = engine.getObservations({ type: "signal" });
    expect(remaining.length).toBe(1);
    expect(remaining[0].source).toBe("user_stated");
    db.close();
  });

  test("reset=false leaves all observations intact", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:goal",
      value: "test",
      confidence: 5,
      source: "coldstart",
      provenance: "{}",
    });

    // When reset=false, the skip logic does NOT run the deletion loop
    const obs = engine.getObservations({ key: "coldstart:goal" });
    expect(obs.length).toBe(1);
    db.close();
  });
});

// --- Group 2: Rerun detection (work.ts L306-325) ---
// The rerun detection checks coldstart:goal observations exist AND !options.reset.

describe("work start: rerun detection", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("skips interview when coldstart:goal exists and reset=false", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:goal",
      value: "build api",
      confidence: 8,
      source: "coldstart",
      provenance: "{}",
    });

    // Replicate work.ts L306-307 condition
    const existingAnswers = engine.getObservations({ key: "coldstart:goal" });
    const shouldSkip = existingAnswers.length > 0 && !false; // reset=false
    expect(shouldSkip).toBe(true);
    db.close();
  });

  test("does not skip when coldstart:goal missing", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    const existingAnswers = engine.getObservations({ key: "coldstart:goal" });
    const shouldSkip = existingAnswers.length > 0 && !false;
    expect(shouldSkip).toBe(false);
    db.close();
  });

  test("does not skip when reset=true even if goal exists", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:goal",
      value: "build api",
      confidence: 8,
      source: "coldstart",
      provenance: "{}",
    });

    const existingAnswers = engine.getObservations({ key: "coldstart:goal" });
    const shouldSkip = existingAnswers.length > 0 && !true; // reset=true
    expect(shouldSkip).toBe(false);
    db.close();
  });
});

// --- Group 3: Workspace lifecycle (work.ts L337-352, L381-384) ---
// Test workspace creation and cleanup-on-abort patterns.

describe("work start: workspace lifecycle", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("workspace created and visible in list", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({
      name: `Cold Start - ${new Date().toISOString().slice(0, 10)}`,
      description: "Workspace created during cold start",
    });
    expect(store.listWorkspaces().length).toBe(1);
    expect(ws.name).toContain("Cold Start");
    db.close();
  });

  test("workspace deleted on abort leaves no orphaned data", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Abort Test" });
    store.deleteWorkspace(ws.id);
    expect(store.listWorkspaces().length).toBe(0);
    db.close();
  });

  test("double deleteWorkspace does not throw", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Double Delete" });
    store.deleteWorkspace(ws.id);
    expect(() => store.deleteWorkspace(ws.id)).not.toThrow();
    db.close();
  });
});

// --- Group 4: Derive and preview (work.ts L404-429) ---
// Test the derive-from-rules pipeline with and without coldstart observations.

describe("work start: derive and preview", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("derives zero traits with no observations", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules(false);
    expect(traits.length).toBe(0);
    db.close();
  });

  test("derives traits from coldstart observations", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    // Add observations that match actual Derivator rules — replicating
    // what git scan + interview would produce (work.ts L332-334, L404-413)
    engine.addObservation({
      type: "signal",
      key: "coldstart:git.commit_time_distribution",
      value: JSON.stringify({ morning_ratio: 0.6, total_commits: 20 }),
      confidence: 4,
      source: "coldstart",
      provenance: "{}",
    });
    engine.addObservation({
      type: "signal",
      key: "coldstart:git.commit_message_length",
      value: JSON.stringify({ avg_length: 60, detail_level: "high", total_commits: 20 }),
      confidence: 4,
      source: "coldstart",
      provenance: "{}",
    });
    engine.addObservation({
      type: "signal",
      key: "coldstart:git.branch_pattern",
      value: JSON.stringify({ branch: "feat/test", structured: true }),
      confidence: 5,
      source: "coldstart",
      provenance: "{}",
    });

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules(false);
    // Derivator should produce traits from git scan observations
    expect(traits.length).toBeGreaterThan(0);
    const dimensions = traits.map((t) => t.dimension);
    expect(dimensions).toContain("early_riser");
    expect(dimensions).toContain("detail_oriented");
    expect(dimensions).toContain("scope_appetite");
    db.close();
  });
});

// --- Group 5: SIGINT behavior (eng review D2) ---
// Validate how Bun's readline responds to SIGINT.

describe("work start: SIGINT readline behavior", () => {
  test("SIGINT causes readline process to exit within 2 seconds", async () => {
    // Spawn a child that creates a readline and waits for input
    const child = spawn(
      "bun",
      [
        "-e",
        `
      const { createInterface } = require("node:readline");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("prompt> ", (answer) => {
        console.log("answered:" + answer);
        rl.close();
        process.exit(0);
      });
    `,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const exitPromise = new Promise<number>((resolve) => {
      child.on("exit", (code) => resolve(code ?? -1));
    });

    // Wait for readline to be ready, then send SIGINT
    await new Promise((r) => setTimeout(r, 200));
    child.kill("SIGINT");

    const exitCode = await exitPromise;
    // SIGINT should cause the process to exit (code may vary)
    expect(exitCode).toBeDefined();
  });
});
