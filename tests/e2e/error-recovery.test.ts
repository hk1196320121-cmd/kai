import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, writeFileSync } from "fs";

describe("E2E: Error recovery", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-e2e-error-${Date.now()}.db`);
  });

  afterEach(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("fresh DB creates schema automatically", () => {
    const db = new KaiDB(dbPath);
    expect(db.integrityCheck()).toBe("ok");
    expect(db.listTables()).toContain("identity");
    db.close();
  });

  test("DB survives schema re-run (idempotent)", () => {
    const db = new KaiDB(dbPath);
    db.runMigrations();
    db.runMigrations();
    expect(db.listTables()).toContain("identity");
    db.close();
  });

  test("corrupted DB throws on open", () => {
    const db = new KaiDB(dbPath);
    db.close();

    // Clean up WAL/SHM files so the corrupted file is the only one present
    for (const suffix of ["-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }

    writeFileSync(dbPath, "NOT A VALID DATABASE");

    expect(() => new KaiDB(dbPath)).toThrow();
  });
});
