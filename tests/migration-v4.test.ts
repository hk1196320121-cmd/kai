import { describe, test, expect, afterEach } from "bun:test";
import { KaiDB } from "../src/db/client";
import { ProfileEngine } from "../src/core/profile/engine";
import { cleanup, tempDb } from "./helpers/temp-db";

describe("MIGRATION_V4", () => {
  let dbPath: string;

  afterEach(() => {
    cleanup(dbPath);
  });

  test("creates workspace tables on fresh DB", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const tables = db.listTables();
    db.close();

    expect(tables).toContain("workspaces");
    expect(tables).toContain("workspace_tasks");
    expect(tables).toContain("workspace_events");
  });

  test("preserves existing observations when migrating from v3", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "behavior",
      key: "test:existing",
      value: '{"text": "hello"}',
      confidence: 5,
      source: "mcp",
      provenance: '{"origin": "test"}',
    });

    const beforeCount = engine.getObservations().length;
    expect(beforeCount).toBe(1);
    db.close();

    // Re-open — triggers MIGRATION_V4
    const db2 = new KaiDB(dbPath);
    const engine2 = new ProfileEngine(db2);
    const afterObservations = engine2.getObservations();
    expect(afterObservations.length).toBe(1);
    expect(afterObservations[0].source).toBe("mcp");
    expect(afterObservations[0].key).toBe("test:existing");
    db2.close();
  });

  test("accepts coldstart and workspace sources after migration", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    const id1 = engine.addObservation({
      type: "signal",
      key: "coldstart:goal",
      value: '{"answer": "build something"}',
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin": "kai work start"}',
    });
    expect(id1).toBeGreaterThan(0);

    const id2 = engine.addObservation({
      type: "signal",
      key: "workspace:task_completed",
      value: '{"task_id": "t1"}',
      confidence: 7,
      source: "workspace",
      provenance: '{"origin": "workspace_event_bus"}',
    });
    expect(id2).toBeGreaterThan(id1);

    db.close();
  });

  test("passes integrity check after migration", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    expect(db.integrityCheck()).toBe("ok");
    db.close();
  });
});
