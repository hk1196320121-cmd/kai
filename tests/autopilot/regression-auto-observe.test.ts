import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { KaiDB } from "../../src/db/client";
import { generateAutoObserveHook } from "../../src/cli/skills/hooks/auto-observe";

describe("Regression: P0 auto-observe CHECK violation", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "kai-regression-"));
    dbPath = join(dbDir, "test.db");
  });

  afterEach(() => {
    try { rmSync(dbDir, { recursive: true }); } catch {}
  });

  test("old hook: type='tool_pattern' is rejected by CHECK", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    expect(() => {
      db.query(
        "INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run("tool_pattern", "Edit", "5", 5, "auto_observe", "{}");
    }).toThrow();
    kai.close();
  });

  test("old hook: confidence='0.6' string is rejected", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    expect(() => {
      db.query(
        "INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run("behavior", "Edit", "5", "0.6" as any, "auto_observe", "{}");
    }).toThrow();
    kai.close();
  });

  test("new hook: type='tool_usage' with int confidence is accepted", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    expect(() => {
      db.query(
        "INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run("tool_usage", "Edit", '{"tool":"Edit"}', 7, "auto_observe", '{"autopilot":true}');
    }).not.toThrow();
    kai.close();
  });

  test("generated script does NOT contain old bug patterns", () => {
    const script = generateAutoObserveHook();
    expect(script).not.toContain('"tool_pattern"');
    expect(script).not.toContain("'tool_pattern'");
    expect(script).not.toContain('"0.6"');
    expect(script).not.toContain("'0.6'");
    expect(script).not.toContain('"auto-observe"');
    expect(script).toContain('"tool_usage"');
    expect(script).toContain('"auto_observe"');
  });

  // [D14] Runtime execution test
  test("runtime: script writes observation to DB", () => {
    const kai = new KaiDB(dbPath);
    kai.close();

    const hookDir = join(dbDir, "hooks");
    mkdirSync(hookDir, { recursive: true });
    const scriptPath = join(hookDir, "kai-auto-observe.cjs");
    const script = generateAutoObserveHook();

    writeFileSync(scriptPath, script);

    const result = spawnSync("bun", [scriptPath], {
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: "/tmp/test.ts" },
        session_id: "test-session-001",
        cwd: "/tmp",
      }),
      env: { ...process.env, KAI_DB: dbPath },
      timeout: 5000,
    });

    expect(result.status).toBe(0);

    const db = new Database(dbPath, { readonly: true });
    const rows = db.query(
      "SELECT * FROM observations WHERE source = 'auto_observe' AND key = 'Edit'"
    ).all() as any[];
    db.close();

    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe("tool_usage");
    expect(rows[0].confidence).toBe(7);
  });

  // [D19] Privacy: tools NOT in allowlist are silently skipped
  test("runtime: non-allowlisted tool is silently skipped", () => {
    const kai = new KaiDB(dbPath);
    kai.close();

    const hookDir = join(dbDir, "hooks");
    mkdirSync(hookDir, { recursive: true });
    const scriptPath = join(hookDir, "kai-auto-observe.cjs");
    writeFileSync(scriptPath, generateAutoObserveHook());

    spawnSync("bun", [scriptPath], {
      input: JSON.stringify({
        tool_name: "SomeRandomPlugin",
        session_id: "test-session-002",
      }),
      env: { ...process.env, KAI_DB: dbPath },
      timeout: 5000,
    });

    const db = new Database(dbPath, { readonly: true });
    const rows = db.query("SELECT * FROM observations WHERE key = 'SomeRandomPlugin'").all();
    db.close();

    expect(rows.length).toBe(0);
  });
});
