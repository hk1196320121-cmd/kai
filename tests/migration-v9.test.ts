import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	VALID_OBSERVATION_TYPES,
	VALID_OBSERVATION_SOURCES,
	sqlTypeCheck,
	sqlSourceCheck,
} from "../src/core/profile/types";
import type { Observation } from "../src/core/profile/types";
import { KaiDB } from "../src/db/client";

describe("Observation type constants (D12)", () => {
	test("VALID_OBSERVATION_TYPES includes tool_usage", () => {
		expect(VALID_OBSERVATION_TYPES).toContain("tool_usage");
		expect(VALID_OBSERVATION_TYPES).toContain("behavior");
		expect(VALID_OBSERVATION_TYPES).toContain("signal");
	});

	test("VALID_OBSERVATION_SOURCES includes auto_observe", () => {
		expect(VALID_OBSERVATION_SOURCES).toContain("auto_observe");
		expect(VALID_OBSERVATION_SOURCES).toContain("hook_error");
	});

	test("constants match TypeScript union", () => {
		type FromConst = (typeof VALID_OBSERVATION_TYPES)[number];
		type FromUnion = Observation["type"];
		const _check: FromConst extends FromUnion ? true : false = true;
		expect(_check).toBe(true);
	});

	test("sqlTypeCheck generates valid SQL CHECK clause", () => {
		const sql = sqlTypeCheck();
		expect(sql).toMatch(/^CHECK\(type IN \(/);
		expect(sql).toContain("'behavior'");
		expect(sql).toContain("'tool_usage'");
	});

	test("sqlSourceCheck generates valid SQL CHECK clause", () => {
		const sql = sqlSourceCheck();
		expect(sql).toMatch(/^CHECK\(source IN \(/);
		expect(sql).toContain("'auto_observe'");
		expect(sql).toContain("'hook_error'");
	});
});

describe("Migration v9", () => {
	let dbDir: string;
	let dbPath: string;

	beforeEach(() => {
		dbDir = mkdtempSync(join(tmpdir(), "kai-v9-test-"));
		dbPath = join(dbDir, "test.db");
	});

	afterEach(() => {
		try { rmSync(dbDir, { recursive: true }); } catch {}
	});

	test("creates autopilot_sessions table", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_sessions'").all();
		expect(tables).toHaveLength(1);
		kai.close();
	});

	test("autopilot_sessions has expected columns", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const cols = db.query("PRAGMA table_info(autopilot_sessions)").all() as { name: string }[];
		const colNames = cols.map(c => c.name);
		expect(colNames).toContain("id");
		expect(colNames).toContain("session_id");
		expect(colNames).toContain("started_at");
		expect(colNames).toContain("stopped_at");
		expect(colNames).toContain("observations_count");
		expect(colNames).toContain("traits_derived");
		expect(colNames).toContain("derivation_status");
		expect(colNames).toContain("project_path");
		kai.close();
	});

	test("observations type CHECK accepts tool_usage", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		expect(() => {
			db.query(
				"INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
			).run("tool_usage", "Edit", "{}", 7, "auto_observe", "{}");
		}).not.toThrow();
		kai.close();
	});

	test("observations source CHECK rejects invalid source", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		expect(() => {
			db.query(
				"INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
			).run("behavior", "x", "{}", 5, "invalid_source", "{}");
		}).toThrow();
		kai.close();
	});

	test("observations rejects invalid type", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		expect(() => {
			db.query(
				"INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
			).run("invalid_type", "x", "{}", 5, "auto_observe", "{}");
		}).toThrow();
		kai.close();
	});

	test("observations rejects string confidence", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		expect(() => {
			db.query(
				"INSERT INTO observations (type, key, value, confidence, source, provenance, ts) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
			).run("tool_usage", "Edit", "{}", "0.6" as any, "auto_observe", "{}");
		}).toThrow();
		kai.close();
	});

	test("schema_version is 9", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const row = db.query("SELECT MAX(version) as v FROM schema_version").get() as { v: number };
		expect(row.v).toBe(9);
		kai.close();
	});

	test("observations has source index [D16]", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const indexes = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_observations_source'").all();
		expect(indexes).toHaveLength(1);
		kai.close();
	});

	test("NO autopilot_nudges table [D6]", () => {
		const kai = new KaiDB(dbPath);
		const db = kai.getDatabase();
		const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_nudges'").all();
		expect(tables).toHaveLength(0);
		kai.close();
	});

	test("DB files have restrictive permissions", () => {
		const kai = new KaiDB(dbPath);
		kai.close();
		const dbStat = statSync(dbPath);
		expect(dbStat.mode & 0o777).toBe(0o600);
	});
});
