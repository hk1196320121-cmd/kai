import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { KaiDB } from "../../../../src/db/client";
import { generateStopHook } from "../../../../src/cli/skills/hooks/stop";
import { TRAIT_UPSERT_SQL } from "../../../../src/autopilot/derive-shared";

/**
 * Generate a kai-derive.cjs that delegates to the real RULES + derive logic.
 * Uses the actual constants and TRAIT_UPSERT_SQL from derive-shared so the
 * test validates against real behavior, not a hand-crafted approximation.
 */
function generateRealDeriveCjs(): string {
  // Use process.cwd() to resolve project root — tests run from project root
  const rulesPath = require("path").resolve(process.cwd(), "src/core/profile/rules");
  return `
const { RULES } = require("${rulesPath}");
const UPSERT_SQL = ${JSON.stringify(TRAIT_UPSERT_SQL)};

function computeTraits(db, corrections) {
  const observations = db.query("SELECT * FROM observations WHERE ts >= datetime('now', '-30 days') ORDER BY ts DESC LIMIT 2000").all();
  if (observations.length === 0) return [];

  const dimMatches = new Map();
  for (const rule of RULES) {
    if (corrections.has(rule.dimension)) continue;
    const matches = observations.filter(obs => rule.match(obs.key, obs.value));
    if (matches.length === 0) continue;

    const existing = dimMatches.get(rule.dimension);
    if (existing) {
      existing.observations.push(...matches);
      existing.derive = rule.derive;
      if (rule.deriveFromValues) existing.deriveFromValues = rule.deriveFromValues;
    } else {
      dimMatches.set(rule.dimension, { observations: [...matches], derive: rule.derive, deriveFromValues: rule.deriveFromValues });
    }
  }

  const results = [];
  for (const [dimension, { observations: obs, derive, deriveFromValues }] of dimMatches) {
    let derived;
    if (deriveFromValues) {
      derived = deriveFromValues(obs.length, obs.map(o => o.value));
    } else {
      derived = derive(obs.length);
    }
    results.push({
      dimension,
      value: Math.round(derived.value * 100) / 100,
      confidence: Math.max(1, derived.confidence),
      source: "observed",
      reasoning: derived.reasoning,
    });
  }
  return results;
}

function persistTraits(db, traits) {
  for (const trait of traits) {
    db.query(UPSERT_SQL).run({ $dim: trait.dimension, $val: trait.value, $conf: trait.confidence, $reason: trait.reasoning });
  }
}

module.exports = {
  deriveFromRulesCore: function(db, corrections) {
    const traits = computeTraits(db, corrections);
    if (traits.length > 0) persistTraits(db, traits);
    return traits;
  }
};
`;
}

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

    // Write derive module using real RULES and constants
    const deriveCjsPath = join(hookDir, "kai-derive.cjs");
    writeFileSync(deriveCjsPath, generateRealDeriveCjs());
    writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook(deriveCjsPath));

    const result = spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
      input: JSON.stringify({ session_id: "stop-test-001" }),
      env: { ...process.env, KAI_DB: dbPath },
      timeout: 10000,
    });

    expect(result.status).toBe(0);

    // Verify traits were derived using real derive constants
    const db2 = new Database(dbPath, { readonly: true });
    const traits = db2.query("SELECT dimension, value FROM traits").all() as { dimension: string; value: number }[];
    db2.close();

    expect(traits.length).toBeGreaterThan(0);
    const autonomy = traits.find(t => t.dimension === "autonomy");
    expect(autonomy).toBeDefined();
    // Real formula: Math.min(1.0, 0.4 + count * 0.1) for 8 Bash obs → 0.4 + 0.8 = 1.0
    expect(autonomy!.value).toBe(1.0);
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

  test("runtime: derivation_status='skipped' when derive module missing", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    db.query(
      "INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now'), 'pending')"
    ).run("skip-test-001");
    kai.close();

    const hookDir = join(dbDir, "hooks");
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook());
    // Intentionally do NOT write kai-derive.cjs

    const result = spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
      input: JSON.stringify({ session_id: "skip-test-001" }),
      env: { ...process.env, KAI_DB: dbPath },
      timeout: 5000,
    });

    expect(result.status).toBe(0);

    const db2 = new Database(dbPath, { readonly: true });
    const session = db2.query("SELECT derivation_status FROM autopilot_sessions WHERE session_id = 'skip-test-001'").get() as { derivation_status: string } | null;
    db2.close();

    expect(session).not.toBeNull();
    expect(session!.derivation_status).toBe("skipped");
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
    const badDeriveCjsPath = join(hookDir, "kai-derive.cjs");
    writeFileSync(badDeriveCjsPath, badDeriveCjs);
    // Regenerate stop hook pointing to the bad derive module
    writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook(badDeriveCjsPath));

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
