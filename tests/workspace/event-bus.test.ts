import { describe, test, expect, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { WorkspaceStore } from "../../src/workspace/store";
import { eventToObservation, processStateChange } from "../../src/workspace/event-bus";
import type { WorkspaceEvent } from "../../src/workspace/types";
import { cleanup, tempDb } from "../helpers/temp-db";

describe("eventToObservation", () => {
  test("converts workspace event to observation", () => {
    const obs = eventToObservation({
      id: 1,
      workspace_id: "ws-1",
      task_id: "t-1",
      event_type: "task_completed",
      payload: '{"task_id": "t-1"}',
      created_at: new Date().toISOString(),
    });

    expect(obs.type).toBe("signal");
    expect(obs.key).toBe("workspace:task_completed");
    expect(obs.confidence).toBe(7);
    expect(obs.source).toBe("workspace");
  });

  test("assigns correct confidence per event type", () => {
    const cases = [
      { event_type: "workspace_created", expected: 3 },
      { event_type: "task_created", expected: 4 },
      { event_type: "task_updated", expected: 5 },
      { event_type: "task_completed", expected: 7 },
      { event_type: "interaction", expected: 6 },
      { event_type: "coldstart_answer", expected: 8 },
    ] as const;

    for (const { event_type, expected } of cases) {
      const obs = eventToObservation({
        id: 1,
        workspace_id: "ws-1",
        task_id: null,
        event_type,
        payload: "{}",
        created_at: new Date().toISOString(),
      });
      expect(obs.confidence).toBe(expected);
    }
  });

  test("unknown event type gets default confidence 5", () => {
    const obs = eventToObservation({
      id: 1,
      workspace_id: "ws-1",
      task_id: null,
      event_type: "custom_event" as any,
      payload: "{}",
      created_at: new Date().toISOString(),
    });
    expect(obs.confidence).toBe(5);
  });

  test("includes workspace_id and task_id in provenance", () => {
    const obs = eventToObservation({
      id: 1,
      workspace_id: "ws-1",
      task_id: "t-1",
      event_type: "task_completed",
      payload: "{}",
      created_at: new Date().toISOString(),
    });

    const prov = JSON.parse(obs.provenance);
    expect(prov.workspace_id).toBe("ws-1");
    expect(prov.task_id).toBe("t-1");
    expect(prov.origin).toBe("workspace_event_bus");
  });
});

describe("processStateChange", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("returns shouldDerive=true for task completion", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Test" });
    const task = store.createTask({ workspace_id: ws.id, title: "T" });

    store.updateTask(task.id, { status: "completed" });
    store.addEvent({
      workspace_id: ws.id,
      task_id: task.id,
      event_type: "task_completed",
      payload: "{}",
    });

    const result = processStateChange(store, ws.id, "task_completed", task.id);

    expect(result.shouldDerive).toBe(true);
    expect(result.observations.length).toBe(1);

    db.close();
  });

  test("returns shouldDerive=true for workspace archived", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Test" });
    store.updateWorkspace(ws.id, { status: "archived" });

    const result = processStateChange(store, ws.id, "workspace_archived");

    expect(result.shouldDerive).toBe(true);

    db.close();
  });

  test("returns shouldDerive=false for task_created", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Test" });

    const result = processStateChange(store, ws.id, "task_created");

    expect(result.shouldDerive).toBe(false);

    db.close();
  });
});
