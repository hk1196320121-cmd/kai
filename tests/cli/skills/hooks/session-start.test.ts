import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { KaiDB } from "../../../../src/db/client";
import { generateSessionStartHook } from "../../../../src/cli/skills/hooks/session-start";

describe("SessionStart hook (revised D11)", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "kai-ss-test-"));
    dbPath = join(dbDir, "test.db");
  });

  afterEach(() => {
    try { rmSync(dbDir, { recursive: true }); } catch {}
  });

  test("runtime: cold start — no DB", () => {
    const scriptPath = join(dbDir, "test.cjs");
    writeFileSync(scriptPath, generateSessionStartHook());
    const result = spawnSync("bun", [scriptPath], {
      input: JSON.stringify({ session_id: "test-001" }),
      env: { ...process.env, KAI_DB: join(dbDir, "nonexistent.db") },
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toContain("Observing your work style");
  });

  test("runtime: warm start — writes session row", () => {
    const kai = new KaiDB(dbPath);
    kai.close();

    const scriptPath = join(dbDir, "test.cjs");
    writeFileSync(scriptPath, generateSessionStartHook());
    const result = spawnSync("bun", [scriptPath], {
      input: JSON.stringify({ session_id: "test-002", cwd: "/tmp" }),
      env: { ...process.env, KAI_DB: dbPath },
      timeout: 5000,
    });

    expect(result.status).toBe(0);

    const { Database } = require("bun:sqlite");
    const db = new Database(dbPath, { readonly: true });
    const sessions = db.query("SELECT * FROM autopilot_sessions WHERE session_id = 'test-002'").all() as any[];
    db.close();

    expect(sessions.length).toBe(1);
    expect(sessions[0].derivation_status).toBe("pending");
    expect(sessions[0].project_path).toBe("/tmp");
  });

  // [D20] Orphan cleanup test
  test("runtime: cleans up stale pending sessions", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    db.query(
      "INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now', '-2 hours'), 'pending')"
    ).run("stale-session-001");
    kai.close();

    const scriptPath = join(dbDir, "test.cjs");
    writeFileSync(scriptPath, generateSessionStartHook());
    spawnSync("bun", [scriptPath], {
      input: JSON.stringify({ session_id: "fresh-session-002" }),
      env: { ...process.env, KAI_DB: dbPath },
      timeout: 5000,
    });

    const { Database } = require("bun:sqlite");
    const db2 = new Database(dbPath, { readonly: true });
    const stale = db2.query("SELECT * FROM autopilot_sessions WHERE session_id = 'stale-session-001'").get() as any;
    db2.close();

    expect(stale.derivation_status).toBe("skipped");
    expect(stale.stopped_at).not.toBeNull();
  });
});
