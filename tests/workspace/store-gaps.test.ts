import { describe, test, expect, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { WorkspaceStore } from "../../src/workspace/store";
import { cleanup, tempDb } from "../helpers/temp-db";

describe("WorkspaceStore - aggregate queries", () => {
	let dbPath: string;
	let db: KaiDB;
	let store: WorkspaceStore;

	afterEach(() => {
		if (db) db.close();
		cleanup(dbPath);
	});

	test("getTaskStatsByWorkspaces returns correct totals", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		const ws1 = store.createWorkspace({ name: "WS1" });
		const ws2 = store.createWorkspace({ name: "WS2" });

		// ws1: 3 tasks, 2 completed
		const t1 = store.createTask({ workspace_id: ws1.id, title: "T1" });
		const t2 = store.createTask({ workspace_id: ws1.id, title: "T2" });
		store.createTask({ workspace_id: ws1.id, title: "T3" });
		store.updateTask(t1.id, { status: "completed" });
		store.updateTask(t2.id, { status: "completed" });

		// ws2: 1 task, 0 completed
		store.createTask({ workspace_id: ws2.id, title: "T4" });

		const stats = store.getTaskStatsByWorkspaces([ws1.id, ws2.id]);
		expect(stats.get(ws1.id)).toEqual({ total: 3, completed: 2 });
		expect(stats.get(ws2.id)).toEqual({ total: 1, completed: 0 });
	});

	test("getTaskStatsByWorkspaces with empty array returns empty map", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		const stats = store.getTaskStatsByWorkspaces([]);
		expect(stats.size).toBe(0);
	});

	test("getTaskStatsByWorkspaces for non-existent workspace returns zeros", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		const stats = store.getTaskStatsByWorkspaces(["fake-id"]);
		expect(stats.get("fake-id")).toEqual({ total: 0, completed: 0 });
	});

	test("getEventCountsByWorkspaces returns correct counts", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		const ws1 = store.createWorkspace({ name: "WS1" });
		const ws2 = store.createWorkspace({ name: "WS2" });

		store.addEvent({
			workspace_id: ws1.id,
			event_type: "task_created",
			payload: "{}",
		});
		store.addEvent({
			workspace_id: ws1.id,
			event_type: "task_completed",
			payload: "{}",
		});
		store.addEvent({
			workspace_id: ws2.id,
			event_type: "interaction",
			payload: "{}",
		});

		const counts = store.getEventCountsByWorkspaces([ws1.id, ws2.id]);
		expect(counts.get(ws1.id)).toBe(2);
		expect(counts.get(ws2.id)).toBe(1);
	});

	test("getEventCountsByWorkspaces with empty array returns empty map", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		const counts = store.getEventCountsByWorkspaces([]);
		expect(counts.size).toBe(0);
	});
});

describe("WorkspaceStore - field-level updates", () => {
	let dbPath: string;
	let db: KaiDB;
	let store: WorkspaceStore;

	afterEach(() => {
		if (db) db.close();
		cleanup(dbPath);
	});

	test("updateWorkspace with name only", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "Original", description: "Keep" });
		store.updateWorkspace(ws.id, { name: "Renamed" });

		const fetched = store.getWorkspace(ws.id);
		expect(fetched!.name).toBe("Renamed");
		expect(fetched!.description).toBe("Keep"); // unchanged
	});

	test("updateWorkspace with no fields is a no-op", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "Original" });
		store.updateWorkspace(ws.id, {});

		const fetched = store.getWorkspace(ws.id);
		expect(fetched!.name).toBe("Original");
	});

	test("updateTask with title and description", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "Tasks" });
		const task = store.createTask({
			workspace_id: ws.id,
			title: "Old title",
			description: "Old desc",
		});

		store.updateTask(task.id, { title: "New title", description: "New desc" });

		const tasks = store.listTasks(ws.id);
		expect(tasks[0].title).toBe("New title");
		expect(tasks[0].description).toBe("New desc");
	});

	test("updateTask with metadata", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "Tasks" });
		const task = store.createTask({
			workspace_id: ws.id,
			title: "T",
		});

		store.updateTask(task.id, {
			metadata: JSON.stringify({ priority: "high" }),
		});

		const tasks = store.listTasks(ws.id);
		expect(tasks[0].metadata).toBe('{"priority":"high"}');
	});

	test("updateTask with no fields is a no-op", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "Tasks" });
		const task = store.createTask({
			workspace_id: ws.id,
			title: "T",
		});

		store.updateTask(task.id, {});

		const tasks = store.listTasks(ws.id);
		expect(tasks[0].title).toBe("T");
	});

	test("getWorkspace returns null for non-existent ID", () => {
		dbPath = tempDb();
		db = new KaiDB(dbPath);
		store = new WorkspaceStore(db);

		expect(store.getWorkspace("nonexistent")).toBeNull();
	});
});
