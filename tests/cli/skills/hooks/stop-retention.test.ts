import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { KaiDB } from "../../../../src/db/client";
import { generateStopHook } from "../../../../src/cli/skills/hooks/stop";

describe("Stop hook: retention and observation counting", () => {
	let dbDir: string;
	let dbPath: string;

	beforeEach(() => {
		dbDir = mkdtempSync(join(tmpdir(), "kai-stop-ret-"));
		dbPath = join(dbDir, "test.db");
	});

	afterEach(() => {
		try { rmSync(dbDir, { recursive: true }); } catch {}
	});

	test("runtime: prunes observations older than 30 days", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		db.query(
			"INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now'), 'pending')"
		).run("retention-test-001");

		// Insert old observation (40 days ago)
		db.query(
			"INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-40 days'))"
		).run("tool_usage", "Edit", '{"tool":"Edit"}', 7, "auto_observe", "{}");

		// Insert recent observation
		db.query(
			"INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
		).run("tool_usage", "Bash", '{"tool":"Bash"}', 7, "auto_observe", "{}");

		kai.close();

		const hookDir = join(dbDir, "hooks");
		mkdirSync(hookDir, { recursive: true });
		writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook());

		spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
			input: JSON.stringify({ session_id: "retention-test-001" }),
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		const db2 = new Database(dbPath, { readonly: true });
		const remaining = db2.query("SELECT * FROM observations").all() as any[];
		db2.close();

		// Old observation should be pruned; only recent one remains
		expect(remaining.length).toBe(1);
		expect(remaining[0].key).toBe("Bash");
	});

	test("runtime: counts observations from current session", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const sessionId = "count-test-001";
		db.query(
			"INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now', '-5 minutes'), 'pending')"
		).run(sessionId);

		// Insert 3 auto_observe observations linked via session_id FK
		for (let i = 0; i < 3; i++) {
			db.query(
				"INSERT INTO observations (type, key, value, confidence, source, provenance, session_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 minutes'))"
			).run("tool_usage", "Edit", '{"tool":"Edit"}', 7, "auto_observe", '{"autopilot":true}', sessionId);
		}
		kai.close();

		const hookDir = join(dbDir, "hooks");
		mkdirSync(hookDir, { recursive: true });
		writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook());

		spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
			input: JSON.stringify({ session_id: sessionId }),
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		const db2 = new Database(dbPath, { readonly: true });
		const session = db2.query(
			"SELECT observations_count FROM autopilot_sessions WHERE session_id = ?"
		).get(sessionId) as { observations_count: number } | null;
		db2.close();

		expect(session).not.toBeNull();
		expect(session!.observations_count).toBe(3);
	});

	test("runtime: sets stopped_at on session", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		db.query(
			"INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now', '-10 minutes'), 'pending')"
		).run("stop-at-test-001");
		kai.close();

		const hookDir = join(dbDir, "hooks");
		mkdirSync(hookDir, { recursive: true });
		writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook());

		spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
			input: JSON.stringify({ session_id: "stop-at-test-001" }),
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		const db2 = new Database(dbPath, { readonly: true });
		const session = db2.query(
			"SELECT stopped_at FROM autopilot_sessions WHERE session_id = ?"
		).get("stop-at-test-001") as { stopped_at: string | null } | null;
		db2.close();

		expect(session).not.toBeNull();
		expect(session!.stopped_at).not.toBeNull();
	});

	test("runtime: derivation_status='skipped' when no derive path provided", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		db.query(
			"INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now'), 'pending')"
		).run("no-derive-001");
		kai.close();

		const hookDir = join(dbDir, "hooks");
		mkdirSync(hookDir, { recursive: true });
		writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook(undefined));

		spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
			input: JSON.stringify({ session_id: "no-derive-001" }),
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		const db2 = new Database(dbPath, { readonly: true });
		const session = db2.query(
			"SELECT derivation_status FROM autopilot_sessions WHERE session_id = ?"
		).get("no-derive-001") as { derivation_status: string } | null;
		db2.close();

		expect(session!.derivation_status).toBe("skipped");
	});

	test("runtime: empty stdin does not crash", () => {
		const kai = new KaiDB(dbPath);
		kai.close();

		const hookDir = join(dbDir, "hooks");
		mkdirSync(hookDir, { recursive: true });
		writeFileSync(join(hookDir, "kai-stop.cjs"), generateStopHook());

		// Empty stdin (no input at all)
		const result = spawnSync("bun", [join(hookDir, "kai-stop.cjs")], {
			input: "",
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		expect(result.status).toBe(0);
	});
});
