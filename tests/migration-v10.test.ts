import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../src/db/client";

describe("Migration v10", () => {
	let dbDir: string;
	let dbPath: string;

	beforeEach(() => {
		dbDir = mkdtempSync(join(tmpdir(), "kai-v10-test-"));
		dbPath = join(dbDir, "test.db");
	});

	afterEach(() => {
		try { rmSync(dbDir, { recursive: true }); } catch {}
	});

	test("creates dispatch_decisions table", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='dispatch_decisions'").all();
		expect(tables).toHaveLength(1);
		kai.close();
	});

	test("dispatch_decisions has expected columns", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const cols = db.query("PRAGMA table_info(dispatch_decisions)").all() as { name: string }[];
		const colNames = cols.map(c => c.name);
		expect(colNames).toContain("id");
		expect(colNames).toContain("task_id");
		expect(colNames).toContain("agent");
		expect(colNames).toContain("confidence");
		expect(colNames).toContain("reasoning");
		expect(colNames).toContain("user_decision");
		expect(colNames).toContain("user_reason");
		expect(colNames).toContain("policy_version");
		expect(colNames).toContain("created_at");
		expect(colNames).toContain("updated_at");
		kai.close();
	});

	test("CHECK constraint rejects invalid user_decision", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		expect(() => {
			db.query(
				"INSERT INTO dispatch_decisions (task_id, agent, confidence, reasoning, user_decision, policy_version) VALUES (?, ?, ?, ?, ?, ?)"
			).run("task-1", "agent-a", 0.9, "looks good", "invalid_value", "v1");
		}).toThrow();
		kai.close();
	});

	test("schema_version is at least 10", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const row = db.query("SELECT MAX(version) as v FROM schema_version").get() as { v: number };
		expect(row.v).toBeGreaterThanOrEqual(10);
		kai.close();
	});

	test("has idx_dispatch_decisions_task_id index", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const indexes = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_dispatch_decisions_task_id'").all();
		expect(indexes).toHaveLength(1);
		kai.close();
	});

	test("has idx_dispatch_decisions_user_decision index", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const indexes = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_dispatch_decisions_user_decision'").all();
		expect(indexes).toHaveLength(1);
		kai.close();
	});

	test("updated_at column exists and has default", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const cols = db.query("PRAGMA table_info(dispatch_decisions)").all() as { name: string; dflt_value: string | null }[];
		const updatedAt = cols.find(c => c.name === "updated_at");
		expect(updatedAt).toBeDefined();
		expect(updatedAt!.dflt_value).toContain("datetime('now')");
		kai.close();
	});
});
