import type { Workspace } from "../../workspace/types";
import { dim, header, kv, nextSteps, section, status } from "../format";

// --- Local types ---

interface WorkspaceWithProgress extends Workspace {
  taskCount: number;
  completedTasks: number;
  eventCount: number;
}

// --- Renderers ---

/**
 * Render detailed workspace status for each workspace.
 */
export function renderWorkspaceStatus(
  workspaces: WorkspaceWithProgress[],
): string {
  const lines: string[] = [];

  lines.push(header("Workspaces"));
  lines.push("");

  if (workspaces.length === 0) {
    lines.push(dim("No active workspaces."));
    lines.push("");
    lines.push(
      nextSteps([
        "kai work create <name>    Create your first workspace",
        "kai work list             Browse existing workspaces",
      ]),
    );
    return lines.join("\n");
  }

  for (const ws of workspaces) {
    const icon =
      ws.status === "active" ? status("success", ws.name) : dim(ws.name);
    lines.push(icon);
    lines.push("");

    const progress =
      ws.taskCount > 0
        ? `${ws.completedTasks}/${ws.taskCount} tasks`
        : "no tasks";

    lines.push(
      section(ws.name, [
        kv("description", ws.description),
        kv("progress", progress),
        kv("events", ws.eventCount),
        kv("created", ws.created_at.slice(0, 10)),
      ]),
    );
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Render a compact list of workspaces.
 */
export function renderWorkspaceList(workspaces: Workspace[]): string {
  if (workspaces.length === 0) {
    return dim("No workspaces found.");
  }

  const lines: string[] = [];

  lines.push(header(`Workspaces (${workspaces.length})`));
  lines.push("");

  for (const ws of workspaces) {
    const bullet = ws.status === "active" ? "●" : "○";
    const name = ws.name.padEnd(24);
    const statusText = dim(ws.status);
    const date = dim(ws.created_at.slice(0, 10));
    lines.push(`${bullet} ${name}${statusText}  ${date}`);
  }

  return lines.join("\n");
}
