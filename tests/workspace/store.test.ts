import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../../src/db/client";
import { WorkspaceStore } from "../../src/workspace/store";

function tempDb(): string {
  return join(
    tmpdir(),
    `kai-ws-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanup(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}

describe("WorkspaceStore", () => {
  let dbPath: string;
  let db: KaiDB;
  let store: WorkspaceStore;

  afterEach(() => {
    if (store) store.close();
    if (db) db.close();
    cleanup(dbPath);
  });

  test("createWorkspace and getWorkspace", () => {
    dbPath = tempDb();
    db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({
      name: "Test Project",
      description: "A test workspace",
    });

    expect(ws.id).toBeDefined();
    expect(ws.name).toBe("Test Project");
    expect(ws.status).toBe("active");

    const fetched = store.getWorkspace(ws.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Test Project");
  });

  test("listWorkspaces returns all workspaces", () => {
    dbPath = tempDb();
    db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    store.createWorkspace({ name: "WS1" });
    store.createWorkspace({ name: "WS2" });
    store.createWorkspace({ name: "WS3" });

    const list = store.listWorkspaces();
    expect(list.length).toBe(3);
  });

  test("updateWorkspace changes fields", () => {
    dbPath = tempDb();
    db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Original" });
    store.updateWorkspace(ws.id, {
      status: "archived",
      description: "Done",
    });

    const updated = store.getWorkspace(ws.id);
    expect(updated!.status).toBe("archived");
    expect(updated!.description).toBe("Done");
  });

  test("deleteWorkspace cascades to tasks and events", () => {
    dbPath = tempDb();
    db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "To Delete" });
    store.createTask({ workspace_id: ws.id, title: "A task" });
    store.addEvent({
      workspace_id: ws.id,
      event_type: "task_created",
      payload: "{}",
    });

    store.deleteWorkspace(ws.id);

    expect(store.getWorkspace(ws.id)).toBeNull();
    expect(store.listTasks(ws.id).length).toBe(0);
    expect(store.listEvents(ws.id).length).toBe(0);
  });

  test("createTask and listTasks", () => {
    dbPath = tempDb();
    db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Tasks" });
    const task = store.createTask({
      workspace_id: ws.id,
      title: "Do something",
      description: "Details here",
    });

    expect(task.id).toBeDefined();
    expect(task.workspace_id).toBe(ws.id);
    expect(task.status).toBe("pending");

    const tasks = store.listTasks(ws.id);
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe("Do something");
  });

  test("updateTask changes status", () => {
    dbPath = tempDb();
    db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Update" });
    const task = store.createTask({ workspace_id: ws.id, title: "T" });
    store.updateTask(task.id, { status: "completed" });

    const tasks = store.listTasks(ws.id);
    expect(tasks[0].status).toBe("completed");
  });

  test("addEvent and listEvents", () => {
    dbPath = tempDb();
    db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Events" });
    store.addEvent({
      workspace_id: ws.id,
      event_type: "task_created",
      payload: '{"task_id": "t1"}',
    });

    const events = store.listEvents(ws.id);
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe("task_created");
  });

  test("addEvent with task_id", () => {
    dbPath = tempDb();
    db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "With Task" });
    const task = store.createTask({ workspace_id: ws.id, title: "T" });
    store.addEvent({
      workspace_id: ws.id,
      task_id: task.id,
      event_type: "task_completed",
      payload: "{}",
    });

    const events = store.listEvents(ws.id);
    expect(events[0].task_id).toBe(task.id);
  });

  test("updateWorkspaceContext sets context JSON", () => {
    dbPath = tempDb();
    db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Context" });
    const snapshot = {
      profile_snapshot: [{ dimension: "test", value: 0.5 }],
    };
    store.updateWorkspaceContext(ws.id, snapshot);

    const fetched = store.getWorkspace(ws.id);
    expect(JSON.parse(fetched!.context)).toEqual(snapshot);
  });
});
