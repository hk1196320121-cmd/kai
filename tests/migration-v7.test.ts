import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";

describe("V7 Migration", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-v7-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("creates all 5 telemetry tables", () => {
    const tables = db.listTables();
    const expected = [
      "runtime_traces",
      "runtime_spans",
      "runtime_events",
      "runtime_state_changes",
      "runtime_errors",
    ];
    for (const table of expected) {
      expect(tables).toContain(table);
    }
  });

  test("creates all telemetry views", () => {
    const database = db.getDatabase();
    const views = database
      .query("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")
      .all() as { name: string }[];
    const viewNames = views.map((v) => v.name);
    expect(viewNames).toContain("telemetry_traces_v1");
    expect(viewNames).toContain("telemetry_spans_v1");
    expect(viewNames).toContain("telemetry_events_v1");
    expect(viewNames).toContain("telemetry_state_changes_v1");
    expect(viewNames).toContain("telemetry_errors_v1");
  });

  test("creates indices on runtime_traces", () => {
    const database = db.getDatabase();
    const indices = database
      .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='runtime_traces'")
      .all() as { name: string }[];
    const names = indices.map((i) => i.name);
    expect(names).toContain("idx_traces_started");
    expect(names).toContain("idx_traces_status");
  });

  test("creates indices on runtime_spans", () => {
    const database = db.getDatabase();
    const indices = database
      .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='runtime_spans'")
      .all() as { name: string }[];
    const names = indices.map((i) => i.name);
    expect(names).toContain("idx_spans_trace");
    expect(names).toContain("idx_spans_operation");
  });

  test("creates index on runtime_errors", () => {
    const database = db.getDatabase();
    const indices = database
      .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='runtime_errors'")
      .all() as { name: string }[];
    const names = indices.map((i) => i.name);
    expect(names).toContain("idx_errors_trace");
    expect(names).toContain("idx_errors_created");
  });

  test("telemetry views are queryable", () => {
    const database = db.getDatabase();
    const traces = database.query("SELECT * FROM telemetry_traces_v1").all();
    expect(traces).toEqual([]);
    const errors = database.query("SELECT * FROM telemetry_errors_v1").all();
    expect(errors).toEqual([]);
  });

  test("can insert and query via views", () => {
    const database = db.getDatabase();
    database.run(
      `INSERT INTO runtime_traces (id, trigger, tool_name, started_at, status)
       VALUES ('t1', 'mcp_request', 'profile.read', datetime('now'), 'completed')`,
    );
    const rows = database
      .query("SELECT * FROM telemetry_traces_v1 WHERE id = ?")
      .all("t1") as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("t1");
  });

  test("preserves existing data through migration", () => {
    const database = db.getDatabase();
    database.run(
      `INSERT INTO observations (type, key, value, confidence, source, provenance)
       VALUES ('behavior', 'pre-v7:test', '{"action":"test"}', 7, 'mcp', '{}')`,
    );
    const row = database
      .query("SELECT * FROM observations WHERE key = 'pre-v7:test'")
      .get() as { confidence: number };
    expect(row.confidence).toBe(7);
  });

  test("migration is idempotent — init twice does not error", () => {
    db.close();
    const db2 = new KaiDB(dbPath);
    const tables = db2.listTables();
    expect(tables).toContain("runtime_traces");
    expect(tables).toContain("runtime_errors");
    db2.close();
  });

  test("schema version is at least 7", () => {
    const database = db.getDatabase();
    const row = database
      .query("SELECT MAX(version) as v FROM schema_version")
      .get() as { v: number };
    expect(row.v).toBeGreaterThanOrEqual(7);
  });
});
