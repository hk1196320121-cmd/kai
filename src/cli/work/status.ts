import { WorkspaceStore } from "../../workspace/store";
import {
  renderWorkspaceList,
  renderWorkspaceStatus,
} from "../renderers/workspace";
import { getEngine } from "../utils";

export function handleWorkStatus(): void {
  const { db } = getEngine();
  const store = new WorkspaceStore(db);
  const workspaces = store.listWorkspaces();
  const active = workspaces.filter((w) => w.status === "active");

  if (active.length === 0) {
    console.log("No active workspaces. Run `kai work start` to create one.");
  } else {
    const ids = active.map((w) => w.id);
    const taskStats = store.getTaskStatsByWorkspaces(ids);
    const eventCounts = store.getEventCountsByWorkspaces(ids);
    const enriched = active.map((ws) => ({
      ...ws,
      taskCount: taskStats.get(ws.id)?.total ?? 0,
      completedTasks: taskStats.get(ws.id)?.completed ?? 0,
      eventCount: eventCounts.get(ws.id) ?? 0,
    }));
    console.log(renderWorkspaceStatus(enriched));
  }
  db.close();
}

export function handleWorkList(): void {
  const { db } = getEngine();
  const store = new WorkspaceStore(db);
  const workspaces = store.listWorkspaces();

  if (workspaces.length > 0) {
    const ids = workspaces.map((w) => w.id);
    const taskStats = store.getTaskStatsByWorkspaces(ids);
    const enriched = workspaces.map((ws) => ({
      ...ws,
      taskCount: taskStats.get(ws.id)?.total ?? 0,
      completedTasks: taskStats.get(ws.id)?.completed ?? 0,
    }));
    console.log(renderWorkspaceList(enriched));
  } else {
    console.log(renderWorkspaceList(workspaces));
  }
  db.close();
}
