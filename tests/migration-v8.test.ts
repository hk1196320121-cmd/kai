import { describe, test, expect, afterEach } from "bun:test";
import { KaiDB } from "../src/db/client";
import { cleanup, tempDb } from "./helpers/temp-db";

describe("V8 Migration", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("workspace_events accepts new recommendation event types", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const raw = db.getDatabase();

    // Seed a workspace so FK constraint on workspace_events is satisfied
    raw
      .query(
        "INSERT INTO workspaces (id, name) VALUES ($id, $name)",
      )
      .run({ $id: "test-ws", $name: "Test Workspace" });

    const newTypes = [
      "recommendation_shown",
      "recommendation_accepted",
      "recommendation_rejected",
      "task_auto_executed",
    ];

    for (const eventType of newTypes) {
      expect(() => {
        raw
          .query(
            "INSERT INTO workspace_events (workspace_id, event_type, payload) VALUES ($ws, $type, '{}')",
          )
          .run({ $ws: "test-ws", $type: eventType });
      }).not.toThrow();
    }

    db.close();
  });

  test("schema version is 8 after migration", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const raw = db.getDatabase();
    const row = raw.query("SELECT MAX(version) as v FROM schema_version").get() as {
      v: number;
    };
    expect(row.v).toBe(8);
    db.close();
  });
});
