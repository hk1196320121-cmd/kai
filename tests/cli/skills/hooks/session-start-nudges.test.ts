import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { KaiDB } from "../../../../src/db/client";
import { generateSessionStartHook } from "../../../../src/cli/skills/hooks/session-start";

describe("SessionStart hook: nudge generation", () => {
	let dbDir: string;
	let dbPath: string;

	beforeEach(() => {
		dbDir = mkdtempSync(join(tmpdir(), "kai-ss-nudge-"));
		dbPath = join(dbDir, "test.db");
	});

	afterEach(() => {
		try { rmSync(dbDir, { recursive: true }); } catch {}
	});

	test("runtime: high autonomy triggers nudge output", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		// Insert a high-autonomy trait
		db.query(
			"INSERT INTO traits (id, dimension, value, confidence, source, reasoning, updated_at) VALUES (lower(hex(randomblob(16))), 'autonomy', 0.85, 8, 'observed', 'test', datetime('now'))"
		).run();
		kai.close();

		const scriptPath = join(dbDir, "test.cjs");
		writeFileSync(scriptPath, generateSessionStartHook());
		const result = spawnSync("bun", [scriptPath], {
			input: JSON.stringify({ session_id: "nudge-test-001", cwd: "/tmp" }),
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		expect(result.status).toBe(0);
		const stdout = result.stdout.toString();
		expect(stdout).toContain("Kai profile active");
		// Nudge for autonomy >= 0.7
		expect(stdout).toContain("autonomy");
	});

	test("runtime: low detail_oriented triggers concise nudge", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		db.query(
			"INSERT INTO traits (id, dimension, value, confidence, source, reasoning, updated_at) VALUES (lower(hex(randomblob(16))), 'detail_oriented', 0.2, 7, 'observed', 'test', datetime('now'))"
		).run();
		kai.close();

		const scriptPath = join(dbDir, "test.cjs");
		writeFileSync(scriptPath, generateSessionStartHook());
		const result = spawnSync("bun", [scriptPath], {
			input: JSON.stringify({ session_id: "nudge-test-002", cwd: "/tmp" }),
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		expect(result.status).toBe(0);
		const stdout = result.stdout.toString();
		// Low detail_oriented should produce concise nudge
		expect(stdout).toContain("detail_oriented");
	});

	test("runtime: shows last session observation count", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		db.query(
			"INSERT INTO traits (id, dimension, value, confidence, source, reasoning, updated_at) VALUES (lower(hex(randomblob(16))), 'autonomy', 0.6, 5, 'observed', 'test', datetime('now'))"
		).run();
		// Insert a completed session with observations
		db.query(
			"INSERT INTO autopilot_sessions (session_id, started_at, stopped_at, derivation_status, observations_count) VALUES (?, datetime('now', '-1 hour'), datetime('now', '-30 minutes'), 'completed', 42)"
		).run("prev-session");
		kai.close();

		const scriptPath = join(dbDir, "test.cjs");
		writeFileSync(scriptPath, generateSessionStartHook());
		const result = spawnSync("bun", [scriptPath], {
			input: JSON.stringify({ session_id: "nudge-test-003", cwd: "/tmp" }),
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		expect(result.status).toBe(0);
		const stdout = result.stdout.toString();
		expect(stdout).toContain("42 observations");
	});

	test("runtime: identity name shown in profile output", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		db.query(
			"INSERT INTO identity (name, role) VALUES (?, ?)"
		).run("Alice", "developer");
		db.query(
			"INSERT INTO traits (id, dimension, value, confidence, source, reasoning, updated_at) VALUES (lower(hex(randomblob(16))), 'autonomy', 0.6, 5, 'observed', 'test', datetime('now'))"
		).run();
		kai.close();

		const scriptPath = join(dbDir, "test.cjs");
		writeFileSync(scriptPath, generateSessionStartHook());
		const result = spawnSync("bun", [scriptPath], {
			input: JSON.stringify({ session_id: "nudge-test-004", cwd: "/tmp" }),
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		expect(result.status).toBe(0);
		const stdout = result.stdout.toString();
		expect(stdout).toContain("(A)"); // First letter uppercase
	});

	test("runtime: no traits — shows observing message", () => {
		const kai = new KaiDB(dbPath);
		kai.close();

		const scriptPath = join(dbDir, "test.cjs");
		writeFileSync(scriptPath, generateSessionStartHook());
		const result = spawnSync("bun", [scriptPath], {
			input: JSON.stringify({ session_id: "nudge-test-005", cwd: "/tmp" }),
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		expect(result.status).toBe(0);
		const stdout = result.stdout.toString();
		expect(stdout).toContain("Observing your work style");
	});

	test("runtime: generates session_id when not provided", () => {
		const kai = new KaiDB(dbPath);
		kai.close();

		const scriptPath = join(dbDir, "test.cjs");
		writeFileSync(scriptPath, generateSessionStartHook());
		const result = spawnSync("bun", [scriptPath], {
			input: JSON.stringify({}), // No session_id
			env: { ...process.env, KAI_DB: dbPath },
			timeout: 5000,
		});

		expect(result.status).toBe(0);

		const { Database } = require("bun:sqlite");
		const db = new Database(dbPath, { readonly: true });
		const sessions = db.query("SELECT * FROM autopilot_sessions").all() as any[];
		db.close();
		// Should have created a session with a generated ID (starts with "ts-")
		expect(sessions.length).toBe(1);
		expect(sessions[0].session_id).toMatch(/^ts-/);
	});
});
