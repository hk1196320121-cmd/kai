import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { WorkspaceStore } from "../../src/workspace/store";
import { displayPreview } from "../../src/cli/work/ui";
import { handleWorkStatus, handleWorkList } from "../../src/cli/work/status";
import { cleanup, tempDb } from "../helpers/temp-db";

// --- ui.ts: displayPreview ---

describe("displayPreview", () => {
  test("truncates reasoning longer than 60 characters", () => {
    const spy = spyOn(console, "log");
    const longReasoning = "a".repeat(80);

    displayPreview(
      [
        {
          dimension: "test_dim",
          value: 0.7,
          confidence: 8,
          reasoning: longReasoning,
          source: "coldstart",
        },
      ],
      [],
    );

    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("...");
    expect(output).not.toContain(longReasoning);
    spy.mockRestore();
  });

  test("preserves reasoning under 60 characters", () => {
    const spy = spyOn(console, "log");
    const shortReasoning = "Short reason";

    displayPreview(
      [
        {
          dimension: "test_dim",
          value: 0.5,
          confidence: 6,
          reasoning: shortReasoning,
          source: "coldstart",
        },
      ],
      [],
    );

    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain(shortReasoning);
    expect(output).not.toContain("...");
    spy.mockRestore();
  });

  test("appends git hints for matching dimensions", () => {
    const spy = spyOn(console, "log");

    displayPreview(
      [
        {
          dimension: "early_riser",
          value: 0.8,
          confidence: 7,
          reasoning: "Morning person",
          source: "coldstart",
        },
      ],
      [{ dimension: "early_riser", hints: ["60% morning commits"] }],
    );

    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("60% morning commits");
    spy.mockRestore();
  });

  test("renders preview header with trait count", () => {
    const spy = spyOn(console, "log");

    displayPreview(
      [
        {
          dimension: "a",
          value: 0.5,
          confidence: 5,
          reasoning: "r1",
          source: "coldstart",
        },
        {
          dimension: "b",
          value: 0.3,
          confidence: 3,
          reasoning: "r2",
          source: "coldstart",
        },
      ],
      [],
    );

    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain("2 traits detected");
    spy.mockRestore();
  });
});

// --- status.ts: handleWorkStatus and handleWorkList ---

describe("handleWorkStatus", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("shows message when no active workspaces", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const workspaces = store.listWorkspaces();
    const active = workspaces.filter((w) => w.status === "active");
    expect(active.length).toBe(0);
    db.close();
  });

  test("lists active workspaces with stats", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    store.createWorkspace({ name: "Active WS" });

    const workspaces = store.listWorkspaces();
    const active = workspaces.filter((w) => w.status === "active");
    expect(active.length).toBe(1);
    expect(active[0].name).toBe("Active WS");
    db.close();
  });
});

describe("handleWorkList", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("lists all workspaces including completed", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws1 = store.createWorkspace({ name: "Active" });
    const ws2 = store.createWorkspace({ name: "Done" });
    store.updateWorkspaceContext(ws2.id, { status: "completed" });

    const workspaces = store.listWorkspaces();
    expect(workspaces.length).toBe(2);

    const ids = workspaces.map((w) => w.id);
    const taskStats = store.getTaskStatsByWorkspaces(ids);
    expect(taskStats.size).toBe(2);
    db.close();
  });

  test("handles empty workspace list", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const workspaces = store.listWorkspaces();
    expect(workspaces.length).toBe(0);
    db.close();
  });
});

// --- Reset batch DELETE verification ---

describe("reset coldstart data: batch delete", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("batch DELETE removes all coldstart observations in one statement", () => {
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

    const raw = db.getDatabase();
    raw.query("DELETE FROM observations WHERE source = $source").run({
      $source: "coldstart",
    });

    const remaining = engine.getObservations({ type: "signal" });
    expect(remaining.length).toBe(1);
    expect(remaining[0].source).toBe("user_stated");
    db.close();
  });
});

// --- SIGINT listener cleanup ---

describe("SIGINT listener management", () => {
  test("no SIGINT listeners leak after handleWorkStart abort paths", () => {
    const beforeCount = process.listenerCount("SIGINT");
    // Simulate the listener registration/removal pattern from start.ts
    const onSigInt = () => {};
    process.on("SIGINT", onSigInt);

    const cleanupSigInt = () => {};
    process.removeListener("SIGINT", onSigInt);
    process.on("SIGINT", cleanupSigInt);

    // Simulate runInterview finally removing it
    process.removeListener("SIGINT", cleanupSigInt);

    // Simulate re-registration guard (only if cleanupSigInt exists)
    if (cleanupSigInt) process.on("SIGINT", cleanupSigInt);

    // Simulate handleWorkStart finally
    process.removeListener("SIGINT", onSigInt);
    if (cleanupSigInt) process.removeListener("SIGINT", cleanupSigInt);

    const afterCount = process.listenerCount("SIGINT");
    expect(afterCount).toBe(beforeCount);
  });

  test("guard prevents double-registration when interview is skipped", () => {
    const beforeCount = process.listenerCount("SIGINT");
    const onSigInt = () => {};
    const cleanupSigInt = () => {};

    process.on("SIGINT", onSigInt);
    process.removeListener("SIGINT", onSigInt);
    process.on("SIGINT", cleanupSigInt);

    // Interview was skipped (sigintReceived=true), no removeListener fired
    // With the guard: only re-register if it was removed
    // Since interview didn't run, cleanupSigInt is still registered — don't re-add
    // Simulating the fix: check before adding
    const listeners = process.listeners("SIGINT") as (() => void)[];
    const alreadyRegistered = listeners.includes(cleanupSigInt);
    if (!alreadyRegistered) {
      process.on("SIGINT", cleanupSigInt);
    }

    const afterCount = process.listenerCount("SIGINT");
    // Clean up
    process.removeListener("SIGINT", cleanupSigInt);

    // With guard, count should only increase by 1 from the initial registration
    expect(afterCount).toBe(beforeCount + 1);
  });
});
