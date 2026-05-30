import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { KaiDB } from "../../src/db/client";
import { AutopilotManager } from "../../src/autopilot/index";
import { deriveFromRulesCore } from "../../src/autopilot/derive-shared";

describe("E2E: Autopilot lifecycle (revised)", () => {
  let dbDir: string;
  let dbPath: string;
  let hooksDir: string;
  let settingsPath: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "kai-e2e-"));
    dbPath = join(dbDir, "kai.db");
    hooksDir = join(dbDir, "hooks");
    settingsPath = join(dbDir, "settings.json");
  });

  afterEach(() => {
    try {
      rmSync(dbDir, { recursive: true });
    } catch {}
  });

  test("full lifecycle: install → session start → tool use × N → stop → traits derived", () => {
    // 1. Install hooks
    const manager = new AutopilotManager(hooksDir);
    manager.install(settingsPath);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.PostToolUse).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();

    // 2. Initialize DB
    const kai = new KaiDB(dbPath);
    kai.close();

    // 3. Simulate session start
    const db = new Database(dbPath);
    const sessionId = "e2e-session-001";
    db.query(
      "INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now'), 'pending')"
    ).run(sessionId);

    // 4. Simulate PostToolUse observations
    for (let i = 0; i < 8; i++) {
      db.query(
        "INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run("tool_usage", "Bash", '{"tool":"Bash"}', 7, "auto_observe", '{"autopilot":true}');
    }
    for (let i = 0; i < 12; i++) {
      db.query(
        "INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run("tool_usage", "Edit", '{"tool":"Edit"}', 7, "auto_observe", '{"autopilot":true}');
    }
    for (let i = 0; i < 5; i++) {
      db.query(
        "INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run("tool_usage", "Grep", '{"tool":"Grep"}', 7, "auto_observe", '{"autopilot":true}');
    }

    // 5. Stop: close session + derive using shared logic
    db.query("UPDATE autopilot_sessions SET stopped_at = datetime('now') WHERE session_id = ?").run(sessionId);
    const derived = deriveFromRulesCore(db, new Set());
    db.close();

    // 6. Verify traits
    expect(derived.length).toBeGreaterThanOrEqual(3);
    const autonomy = derived.find(t => t.dimension === "autonomy");
    const codeFocus = derived.find(t => t.dimension === "code_focus");
    const exploratory = derived.find(t => t.dimension === "exploratory");

    expect(autonomy).toBeDefined();
    expect(autonomy!.value).toBeGreaterThan(0.5);
    expect(codeFocus).toBeDefined();
    expect(codeFocus!.value).toBeGreaterThan(0.5);
    expect(exploratory).toBeDefined();

    // 7. Verify session stats
    const db2 = new Database(dbPath);
    db2.query(
      "UPDATE autopilot_sessions SET observations_count = ?, traits_derived = ?, derivation_status = 'completed' WHERE session_id = ?"
    ).run(25, derived.length, sessionId);

    const session = db2.query("SELECT * FROM autopilot_sessions WHERE session_id = ?").get(sessionId) as any;
    expect(session.observations_count).toBe(25);
    expect(session.traits_derived).toBeGreaterThanOrEqual(3);
    expect(session.derivation_status).toBe("completed");
    db2.close();

    // 8. Verify traits persisted
    const db3 = new Database(dbPath, { readonly: true });
    const traits = db3.query("SELECT dimension FROM traits").all() as { dimension: string }[];
    expect(traits.length).toBeGreaterThanOrEqual(3);
    const dimensions = traits.map(t => t.dimension);
    expect(dimensions).toContain("autonomy");
    expect(dimensions).toContain("code_focus");
    expect(dimensions).toContain("exploratory");
    db3.close();
  });

  test("uninstall removes all Kai hooks", () => {
    const manager = new AutopilotManager(hooksDir);
    manager.install(settingsPath);
    manager.uninstall(settingsPath);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const allHooks = Object.values(settings.hooks || {})
      .flat()
      .flatMap((g: any) => g.hooks || []);
    const kaiHooks = allHooks.filter((h: any) =>
      /kai-(session-start|auto-observe|stop)/.test(h.command)
    );
    expect(kaiHooks).toHaveLength(0);
  });
});
