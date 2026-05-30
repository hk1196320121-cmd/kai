import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { KaiDB } from "../../../../src/db/client";
import { generateStopHook } from "../../../../src/cli/skills/hooks/stop";

describe("Stop hook (revised D7/D17)", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "kai-stop-test-"));
    dbPath = join(dbDir, "test.db");
  });

  afterEach(() => {
    try { rmSync(dbDir, { recursive: true }); } catch {}
  });

  test("runtime: derives traits from tool_usage observations", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    // Create session
    db.query(
      "INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now'), 'pending')"
    ).run("stop-test-001");
    // Insert observations
    for (let i = 0; i < 8; i++) {
      db.query(
        "INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run("tool_usage", "Bash", '{"tool":"Bash"}', 7, "auto_observe", '{"autopilot":true}');
    }
    kai.close();

    // Write Stop hook script
    const hookDir = join(dbDir, "hooks");
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook());

    // Also write a kai-derive.cjs that the stop hook will require
    // For testing, we create a simple one that uses inline derive logic
    const deriveCjs = `
const { Database } = require("bun:sqlite");
// Inline derive logic for testing
module.exports = { deriveFromRulesCore: function(db, corrections) {
  const observations = db.query("SELECT * FROM observations ORDER BY ts DESC").all();
  if (observations.length === 0) return [];
  const results = [];
  // Simple rule matching for Bash -> autonomy
  const bashMatches = observations.filter(o => {
    try { return JSON.parse(o.value).tool === "Bash"; } catch { return false; }
  });
  if (bashMatches.length > 0 && !corrections.has("autonomy")) {
    const count = bashMatches.length;
    results.push({ dimension: "autonomy", value: Math.min(1.0, 0.3 + count * 0.08), confidence: Math.min(10, 3 + count), source: "observed", reasoning: "Bash usage " + count });
    db.query("INSERT INTO traits (id, dimension, value, confidence, source, reasoning, updated_at) VALUES (lower(hex(randomblob(16))), 'autonomy', ?, ?, 'observed', ?, datetime('now')) ON CONFLICT(dimension) DO UPDATE SET value=excluded.value, confidence=excluded.confidence, source=excluded.source, reasoning=excluded.reasoning, updated_at=datetime('now')")
      .run(Math.min(1.0, 0.3 + count * 0.08), Math.min(10, 3 + count), "Bash usage " + count);
  }
  return results;
}};
`;
    writeFileSync(join(hookDir, "kai-derive.cjs"), deriveCjs);

    const result = spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
      input: JSON.stringify({ session_id: "stop-test-001" }),
      env: { ...process.env, KAI_DB: dbPath },
      timeout: 10000,
    });

    expect(result.status).toBe(0);

    // Verify traits were derived
    const db2 = new Database(dbPath, { readonly: true });
    const traits = db2.query("SELECT dimension FROM traits").all() as { dimension: string }[];
    db2.close();

    expect(traits.length).toBeGreaterThan(0);
    expect(traits.map(t => t.dimension)).toContain("autonomy");
  });

  test("runtime: session_id=null does not crash", () => {
    const kai = new KaiDB(dbPath);
    kai.close();

    const hookDir = join(dbDir, "hooks");
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook());

    const result = spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
      input: "{}",
      env: { ...process.env, KAI_DB: dbPath },
      timeout: 5000,
    });

    expect(result.status).toBe(0);
  });

  test("runtime: DB missing does not crash", () => {
    const hookDir = join(dbDir, "hooks");
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook());

    const result = spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
      input: JSON.stringify({ session_id: "test" }),
      env: { ...process.env, KAI_DB: join(dbDir, "nonexistent.db") },
      timeout: 5000,
    });

    expect(result.status).toBe(0);
  });

  test("runtime: sets derivation_status='failed' on derive error", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    db.query(
      "INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now'), 'pending')"
    ).run("fail-test-001");
    kai.close();

    const hookDir = join(dbDir, "hooks");
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook());

    // Write a kai-derive.cjs that throws
    const badDeriveCjs = `
module.exports = { deriveFromRulesCore: function(db, corrections) {
  throw new Error("intentional derive failure");
}};
`;
    writeFileSync(join(hookDir, "kai-derive.cjs"), badDeriveCjs);

    const result = spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
      input: JSON.stringify({ session_id: "fail-test-001" }),
      env: { ...process.env, KAI_DB: dbPath },
      timeout: 5000,
    });

    // Even if derive fails, hook should exit cleanly
    expect(result.status).toBe(0);

    // Verify derivation_status is 'failed'
    const db2 = new Database(dbPath, { readonly: true });
    const session = db2.query("SELECT derivation_status FROM autopilot_sessions WHERE session_id = 'fail-test-001'").get() as { derivation_status: string } | null;
    db2.close();

    expect(session).not.toBeNull();
    expect(session!.derivation_status).toBe("failed");
  });
});
