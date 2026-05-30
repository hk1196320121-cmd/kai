import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutopilotManager } from "../../src/autopilot/index";
import { KaiDB } from "../../src/db/client";

describe("AutopilotManager: status edge cases", () => {
	let tmpDir: string;
	let dbPath: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "kai-status-edge-"));
		dbPath = join(tmpDir, "kai.db");
	});

	afterEach(() => {
		try { rmSync(tmpDir, { recursive: true }); } catch {}
	});

	test("status() returns empty when DB has sessions table but no rows", () => {
		const kai = new KaiDB(dbPath);
		kai.close();

		const mgr = new AutopilotManager(join(tmpDir, "hooks"));
		const result = mgr.status(dbPath);
		expect(result.sessions).toEqual([]);
		expect(result.activeSession).toBeNull();
	});

	test("status() identifies multiple sessions with correct active/inactive", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		// Insert 3 sessions: 2 closed, 1 active
		db.query(
			"INSERT INTO autopilot_sessions (session_id, started_at, derivation_status, stopped_at) VALUES (?, datetime('now', '-3 hours'), 'completed', datetime('now', '-2 hours'))"
		).run("old-session-1");
		db.query(
			"INSERT INTO autopilot_sessions (session_id, started_at, derivation_status, stopped_at) VALUES (?, datetime('now', '-1 hour'), 'failed', datetime('now', '-30 minutes'))"
		).run("failed-session");
		db.query(
			"INSERT INTO autopilot_sessions (session_id, started_at, derivation_status) VALUES (?, datetime('now'), 'pending')"
		).run("active-session");
		kai.close();

		const mgr = new AutopilotManager(join(tmpDir, "hooks"));
		const result = mgr.status(dbPath);
		expect(result.sessions.length).toBe(3);
		expect(result.activeSession).not.toBeNull();
		expect(result.activeSession!.session_id).toBe("active-session");
	});

	test("status() handles DB with pre-v9 schema (no autopilot_sessions table)", () => {
		// Create a DB with only the v8 schema by manually controlling migration
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		// Drop the autopilot_sessions table to simulate pre-v9
		db.run("DROP TABLE IF EXISTS autopilot_sessions");
		kai.close();

		const mgr = new AutopilotManager(join(tmpDir, "hooks"));
		const result = mgr.status(dbPath);
		expect(result.sessions).toEqual([]);
		expect(result.activeSession).toBeNull();
	});
});

describe("AutopilotManager: install edge cases", () => {
	let tmpDir: string;
	let hooksDir: string;
	let settingsPath: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "kai-install-edge-"));
		hooksDir = join(tmpDir, "hooks");
		settingsPath = join(tmpDir, "settings.json");
	});

	afterEach(() => {
		try { rmSync(tmpDir, { recursive: true }); } catch {}
	});

	test("install() derives stop hook embeds derivePath", () => {
		const mgr = new AutopilotManager(hooksDir);
		mgr.install(settingsPath);

		const stopScript = readFileSync(join(hooksDir, "kai-stop.cjs"), "utf-8");
		// The deriveScriptPath should be set (either null or a real path)
		expect(stopScript).toContain("deriveScriptPath");
	});

	test("install() Stop hook has 30s timeout", () => {
		const mgr = new AutopilotManager(hooksDir);
		mgr.install(settingsPath);

		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		const stopHook = settings.hooks.Stop[0];
		const hook = stopHook.hooks[0];
		expect(hook.timeout).toBe(30);
	});

	test("install() SessionStart hook has no timeout", () => {
		const mgr = new AutopilotManager(hooksDir);
		mgr.install(settingsPath);

		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		const sessionStartHook = settings.hooks.SessionStart[0];
		const hook = sessionStartHook.hooks[0];
		expect(hook.timeout).toBeUndefined();
	});
});
