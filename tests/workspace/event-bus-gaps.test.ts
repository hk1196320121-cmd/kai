import { describe, test, expect, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { WorkspaceStore } from "../../src/workspace/store";
import { eventToObservation, processStateChange } from "../../src/workspace/event-bus";
import { cleanup, tempDb } from "../helpers/temp-db";

describe("eventToObservation - edge cases", () => {
	test("event with null task_id includes null in provenance", () => {
		const obs = eventToObservation({
			id: 1,
			workspace_id: "ws-1",
			task_id: null,
			event_type: "workspace_created",
			payload: '{"name":"test"}',
			created_at: new Date().toISOString(),
		});

		const prov = JSON.parse(obs.provenance);
		expect(prov.workspace_id).toBe("ws-1");
		expect(prov.task_id).toBeNull();
		expect(prov.origin).toBe("workspace_event_bus");
	});

	test("observation value is the event payload", () => {
		const payload = '{"task_id":"abc","result":"done"}';
		const obs = eventToObservation({
			id: 2,
			workspace_id: "ws-1",
			task_id: null,
			event_type: "task_completed",
			payload,
			created_at: new Date().toISOString(),
		});

		expect(obs.value).toBe(payload);
	});
});

describe("processStateChange - gap coverage", () => {
	let dbPath: string;

	afterEach(() => cleanup(dbPath));

	test("returns empty observations when no events match task_id filter", () => {
		dbPath = tempDb();
		const db = new KaiDB(dbPath);
		const store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "Test" });
		// Create tasks so FK constraint is satisfied
		const otherTask = store.createTask({ workspace_id: ws.id, title: "Other" });

		// Add an event for a different task
		store.addEvent({
			workspace_id: ws.id,
			task_id: otherTask.id,
			event_type: "task_completed",
			payload: "{}",
		});

		// Query with a different task_id that has no events
		const result = processStateChange(store, ws.id, "task_completed", "nonexistent-task-id");

		expect(result.observations.length).toBe(0);

		db.close();
	});

	test("returns observations filtered by task_id when provided", () => {
		dbPath = tempDb();
		const db = new KaiDB(dbPath);
		const store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "Test" });
		// Create tasks so FK constraint is satisfied
		const targetTask = store.createTask({ workspace_id: ws.id, title: "Target" });
		const otherTask = store.createTask({ workspace_id: ws.id, title: "Other" });

		store.addEvent({
			workspace_id: ws.id,
			task_id: targetTask.id,
			event_type: "task_completed",
			payload: '{"result":"done"}',
		});
		store.addEvent({
			workspace_id: ws.id,
			task_id: otherTask.id,
			event_type: "task_completed",
			payload: '{"result":"other"}',
		});

		const result = processStateChange(store, ws.id, "task_completed", targetTask.id);

		expect(result.observations.length).toBe(1);
		expect(result.observations[0].value).toBe('{"result":"done"}');

		db.close();
	});

	test("returns all matching events when task_id is undefined", () => {
		dbPath = tempDb();
		const db = new KaiDB(dbPath);
		const store = new WorkspaceStore(db);

		const ws = store.createWorkspace({ name: "Test" });
		store.addEvent({
			workspace_id: ws.id,
			event_type: "task_completed",
			payload: "{}",
		});
		store.addEvent({
			workspace_id: ws.id,
			event_type: "task_completed",
			payload: "{}",
		});

		const result = processStateChange(store, ws.id, "task_completed");

		expect(result.observations.length).toBe(2);

		db.close();
	});

	test("handles store errors gracefully", () => {
		dbPath = tempDb();
		const db = new KaiDB(dbPath);
		const store = new WorkspaceStore(db);

		// Close the database to cause an error
		db.close();

		const result = processStateChange(store, "nonexistent", "task_completed");

		expect(result.shouldDerive).toBe(false);
		expect(result.observations).toEqual([]);
	});
});
