import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { KaiDB } from "../db/client";
import type { Workspace, Task, WorkspaceEvent } from "./types";

export class WorkspaceStore {
  private db: Database;

  constructor(kaiDb: KaiDB) {
    this.db = kaiDb.getDatabase();
  }

  createWorkspace(input: {
    name: string;
    description?: string;
  }): Workspace {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO workspaces (id, name, description) VALUES ($id, $name, $desc)`,
      )
      .run({ $id: id, $name: input.name, $desc: input.description ?? "" });
    return this.getWorkspace(id)!;
  }

  getWorkspace(id: string): Workspace | null {
    return this.db
      .query("SELECT * FROM workspaces WHERE id = $id")
      .get({ $id: id }) as Workspace | null;
  }

  listWorkspaces(): Workspace[] {
    return this.db
      .query("SELECT * FROM workspaces ORDER BY created_at DESC")
      .all() as Workspace[];
  }

  updateWorkspace(
    id: string,
    fields: Partial<Pick<Workspace, "name" | "description" | "status">>,
  ): void {
    const sets: string[] = [];
    const params: Record<string, string> = { $id: id };

    if (fields.name !== undefined) {
      sets.push("name = $name");
      params.$name = fields.name;
    }
    if (fields.description !== undefined) {
      sets.push("description = $desc");
      params.$desc = fields.description;
    }
    if (fields.status !== undefined) {
      sets.push("status = $status");
      params.$status = fields.status;
    }

    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    this.db
      .query(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = $id`)
      .run(params);
  }

  updateWorkspaceContext(id: string, context: unknown): void {
    this.db
      .query(
        "UPDATE workspaces SET context = $ctx, updated_at = datetime('now') WHERE id = $id",
      )
      .run({ $id: id, $ctx: JSON.stringify(context) });
  }

  deleteWorkspace(id: string): void {
    this.db.query("DELETE FROM workspaces WHERE id = $id").run({ $id: id });
  }

  createTask(input: {
    workspace_id: string;
    title: string;
    description?: string;
    metadata?: string;
  }): Task {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO workspace_tasks (id, workspace_id, title, description, metadata) VALUES ($id, $ws, $title, $desc, $meta)`,
      )
      .run({
        $id: id,
        $ws: input.workspace_id,
        $title: input.title,
        $desc: input.description ?? "",
        $meta: input.metadata ?? "{}",
      });
    return this.db
      .query("SELECT * FROM workspace_tasks WHERE id = $id")
      .get({ $id: id }) as Task;
  }

  listTasks(workspaceId: string): Task[] {
    return this.db
      .query(
        "SELECT * FROM workspace_tasks WHERE workspace_id = $ws ORDER BY created_at",
      )
      .all({ $ws: workspaceId }) as Task[];
  }

  updateTask(
    id: string,
    fields: Partial<Pick<Task, "title" | "description" | "status" | "metadata">>,
  ): void {
    const sets: string[] = [];
    const params: Record<string, string> = { $id: id };

    if (fields.title !== undefined) {
      sets.push("title = $v");
      params.$v = fields.title;
    }
    if (fields.description !== undefined) {
      sets.push("description = $v2");
      params.$v2 = fields.description;
    }
    if (fields.status !== undefined) {
      sets.push("status = $v3");
      params.$v3 = fields.status;
    }
    if (fields.metadata !== undefined) {
      sets.push("metadata = $v4");
      params.$v4 = fields.metadata;
    }

    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    this.db
      .query(
        `UPDATE workspace_tasks SET ${sets.join(", ")} WHERE id = $id`,
      )
      .run(params);
  }

  addEvent(input: {
    workspace_id: string;
    task_id?: string;
    event_type: string;
    payload: string;
  }): void {
    this.db
      .query(
        `INSERT INTO workspace_events (workspace_id, task_id, event_type, payload) VALUES ($ws, $task, $type, $payload)`,
      )
      .run({
        $ws: input.workspace_id,
        $task: input.task_id ?? null,
        $type: input.event_type,
        $payload: input.payload,
      });
  }

  listEvents(workspaceId: string): WorkspaceEvent[] {
    return this.db
      .query(
        "SELECT * FROM workspace_events WHERE workspace_id = $ws ORDER BY created_at",
      )
      .all({ $ws: workspaceId }) as WorkspaceEvent[];
  }

  close(): void {
    // DB lifetime managed by KaiDB caller
  }
}
