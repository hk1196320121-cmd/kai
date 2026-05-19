export interface Workspace {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived" | "completed";
  context: string; // JSON: workspace-level metadata (profile_snapshot, etc.)
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  metadata: string; // JSON: task-type-specific data
  created_at: string;
  updated_at: string;
}

export interface WorkspaceEvent {
  id: number;
  workspace_id: string;
  task_id: string | null;
  event_type: WorkspaceEventType;
  payload: string; // JSON
  created_at: string;
}

export type WorkspaceEventType =
  | "workspace_created"
  | "task_created"
  | "task_updated"
  | "task_completed"
  | "interaction"
  | "coldstart_answer";

export interface IWorkspaceAdapter {
  readonly name: string;
  fetchEvents(since: string): WorkspaceEvent[];
  pushTask(task: Omit<Task, "created_at" | "updated_at">): void;
  pushEvent(event: Omit<WorkspaceEvent, "id" | "created_at">): void;
}
