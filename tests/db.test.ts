import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../src/db/client";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";

describe("KaiDB", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("creates database file on init", () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  test("creates all required tables", () => {
    const tables = db.listTables();
    expect(tables).toContain("identity");
    expect(tables).toContain("traits");
    expect(tables).toContain("preferences");
    expect(tables).toContain("observations");
  });

  test("enables WAL mode", () => {
    const mode = db.getJournalMode();
    expect(mode).toBe("wal");
  });

  test("schema is idempotent — init twice does not error", () => {
    db.runMigrations();
    const tables = db.listTables();
    expect(tables).toContain("identity");
  });

  test("PRAGMA integrity_check passes", () => {
    const result = db.integrityCheck();
    expect(result).toBe("ok");
  });
});
