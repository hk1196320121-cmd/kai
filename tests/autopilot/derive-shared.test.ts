import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveFromRulesCore } from "../../src/autopilot/derive-shared";
import { KaiDB } from "../../src/db/client";

describe("deriveFromRulesCore [D3]", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "kai-derive-test-"));
    dbPath = join(dbDir, "test.db");
  });

  afterEach(() => {
    try {
      rmSync(dbDir, { recursive: true });
    } catch {}
  });

  test("returns empty array when no observations", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    const result = deriveFromRulesCore(db, new Set());
    expect(result).toEqual([]);
    kai.close();
  });

  test("derives autonomy from Bash tool_usage observations", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    for (let i = 0; i < 5; i++) {
      db.query(
        "INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      ).run(
        "tool_usage",
        "Bash",
        '{"tool":"Bash"}',
        7,
        "auto_observe",
        '{"autopilot":true}',
      );
    }
    const result = deriveFromRulesCore(db, new Set());
    expect(result.length).toBeGreaterThan(0);
    const autonomy = result.find((t) => t.dimension === "autonomy");
    expect(autonomy).toBeDefined();
    expect(autonomy?.value).toBeGreaterThan(0.5);
    kai.close();
  });

  test("persists derived traits to DB", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    for (let i = 0; i < 5; i++) {
      db.query(
        "INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      ).run(
        "tool_usage",
        "Edit",
        '{"tool":"Edit"}',
        7,
        "auto_observe",
        '{"autopilot":true}',
      );
    }
    deriveFromRulesCore(db, new Set());
    kai.close();

    const kai2 = new KaiDB(dbPath);
    const db2 = kai2.getDatabase();
    const traits = db2.query("SELECT dimension FROM traits").all() as {
      dimension: string;
    }[];
    kai2.close();
    expect(traits.length).toBeGreaterThan(0);
  });

  test("skips corrected dimensions", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    for (let i = 0; i < 5; i++) {
      db.query(
        "INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      ).run(
        "tool_usage",
        "Bash",
        '{"tool":"Bash"}',
        7,
        "auto_observe",
        '{"autopilot":true}',
      );
    }
    const result = deriveFromRulesCore(db, new Set(["autonomy"]));
    const autonomy = result.find((t) => t.dimension === "autonomy");
    expect(autonomy).toBeUndefined();
    kai.close();
  });
});
