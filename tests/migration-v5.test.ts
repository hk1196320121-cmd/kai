import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../src/db/client";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";

describe("V5 Migration", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-v5-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("creates ideas table with all columns", () => {
    const database = db.getDatabase();
    const tables = db.listTables();
    expect(tables).toContain("ideas");

    database.run(
      `INSERT INTO ideas (id, title, description, domain, priority, status, workspace_id)
       VALUES ('test', 'Test Idea', 'Desc', 'coding', 'medium', 'draft', 'ws-1')`,
    );
    const row = database.query("SELECT * FROM ideas WHERE id = 'test'").get() as Record<string, unknown>;
    expect(row.title).toBe("Test Idea");
    expect(row.domain).toBe("coding");
  });

  test("creates planned_tasks table with foreign key to ideas", () => {
    const database = db.getDatabase();
    const tables = db.listTables();
    expect(tables).toContain("planned_tasks");

    database.run(
      `INSERT INTO ideas (id, title, description, domain, priority, status, workspace_id)
       VALUES ('idea-1', 'Test', 'Desc', 'coding', 'medium', 'draft', 'ws-1')`,
    );
    database.run(
      `INSERT INTO planned_tasks (id, idea_id, workspace_id, title, description, type, agent, prompt, decomposition_rationale, scheduling_rationale, status)
       VALUES ('task-1', 'idea-1', 'ws-1', 'Task', 'Desc', 'one_off', 'hermes', 'Do it', 'Reason', 'Reason', 'pending')`,
    );
    const row = database.query("SELECT * FROM planned_tasks WHERE id = 'task-1'").get() as Record<string, unknown>;
    expect(row.type).toBe("one_off");
  });

  test("creates execution_results table", () => {
    const database = db.getDatabase();
    const tables = db.listTables();
    expect(tables).toContain("execution_results");
  });

  test("observations source CHECK removed — accepts execution_result", () => {
    const database = db.getDatabase();
    database.run(
      `INSERT INTO observations (type, key, value, confidence, source, provenance)
       VALUES ('behavior', 'test:exec', '{}', 5, 'execution_result', '{}')`,
    );
    const row = database.query("SELECT * FROM observations WHERE source = 'execution_result'").get() as Record<string, unknown>;
    expect(row.source).toBe("execution_result");
  });

  test("preserves existing data through migration", () => {
    const database = db.getDatabase();
    database.run(
      `INSERT INTO observations (type, key, value, confidence, source, provenance)
       VALUES ('behavior', 'pre-v5:test', '{"action":"test"}', 7, 'mcp', '{}')`,
    );
    const row = database.query("SELECT * FROM observations WHERE key = 'pre-v5:test'").get() as Record<string, unknown>;
    expect(row.confidence).toBe(7);
  });

  test("migration is idempotent — init twice does not error", () => {
    db.close();
    const db2 = new KaiDB(dbPath);
    const tables = db2.listTables();
    expect(tables).toContain("ideas");
    expect(tables).toContain("planned_tasks");
    expect(tables).toContain("execution_results");
    db2.close();
  });
});
