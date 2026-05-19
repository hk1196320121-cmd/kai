import { describe, test, expect, afterEach } from "bun:test";
import { KaiDB } from "../src/db/client";
import { ProfileEngine } from "../src/core/profile/engine";
import { WorkspaceStore } from "../src/workspace/store";
import { computeProfileDiff } from "../src/cli/profile";
import { cleanup, tempDb } from "./helpers/temp-db";

describe("computeProfileDiff - gap coverage", () => {
	let dbPath: string;

	afterEach(() => cleanup(dbPath));

	test("detects removed traits", () => {
		dbPath = tempDb();
		const db = new KaiDB(dbPath);
		const engine = new ProfileEngine(db);
		const store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "Cold Start" });
		const snapshotTraits = [
			{ dimension: "early_riser", value: 0.6, confidence: 5, reasoning: "cold start" },
			{ dimension: "tinkerer", value: 0.4, confidence: 4, reasoning: "cold start" },
		];
		store.updateWorkspaceContext(ws.id, {
			profile_snapshot: snapshotTraits,
			coldstart_completed_at: new Date().toISOString(),
		});

		// Only set one trait -- the other is "removed"
		engine.setTrait({
			dimension: "early_riser",
			value: 0.6,
			confidence: 5,
			source: "observed",
			reasoning: "still here",
		});

		const diff = computeProfileDiff(engine, store);

		expect(diff).not.toBeNull();
		expect(diff!.removed.length).toBe(1);
		expect(diff!.removed[0].dimension).toBe("tinkerer");
		expect(diff!.removed[0].before.value).toBe(0.4);
		expect(diff!.removed[0].after.value).toBe(0);

		db.close();
	});

	test("skips workspace with invalid context JSON", () => {
		dbPath = tempDb();
		const db = new KaiDB(dbPath);
		const engine = new ProfileEngine(db);
		const store = new WorkspaceStore(db);

		// Create a workspace and set invalid context directly via raw SQL
		const ws = store.createWorkspace({ name: "Bad Context" });
		// updateWorkspaceContext JSON.stringify's, so use raw db to set bad data
		const rawDb = (db as any).db || (db as any).getDatabase();
		rawDb.run("UPDATE workspaces SET context = 'not valid json' WHERE id = ?", [ws.id]);

		// Should return null since no workspace has valid snapshot
		const diff = computeProfileDiff(engine, store);
		expect(diff).toBeNull();

		db.close();
	});

	test("skips workspace with valid JSON but no profile_snapshot", () => {
		dbPath = tempDb();
		const db = new KaiDB(dbPath);
		const engine = new ProfileEngine(db);
		const store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "No Snapshot" });
		store.updateWorkspaceContext(ws.id, { other_data: "here" });

		const diff = computeProfileDiff(engine, store);
		expect(diff).toBeNull();

		db.close();
	});

	test("coldstartDate falls back to workspace created_at when coldstart_completed_at missing", () => {
		dbPath = tempDb();
		const db = new KaiDB(dbPath);
		const engine = new ProfileEngine(db);
		const store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "Fallback Date" });
		store.updateWorkspaceContext(ws.id, {
			profile_snapshot: [
				{ dimension: "test", value: 0.5, confidence: 5, reasoning: "test" },
			],
			// no coldstart_completed_at
		});

		engine.setTrait({
			dimension: "test",
			value: 0.5,
			confidence: 5,
			source: "observed",
			reasoning: "test",
		});

		const diff = computeProfileDiff(engine, store);

		expect(diff).not.toBeNull();
		// Should use workspace created_at as fallback
		expect(diff!.coldstartDate).toBeTruthy();

		db.close();
	});
});
