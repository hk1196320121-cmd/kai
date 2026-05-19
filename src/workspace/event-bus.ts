import type { AddObservationInput } from "../core/profile/engine";
import type { WorkspaceStore } from "./store";
import type { WorkspaceEvent } from "./types";

const CONFIDENCE_BY_EVENT_TYPE: Record<string, number> = {
  workspace_created: 3,
  task_created: 4,
  task_updated: 5,
  task_completed: 7,
  interaction: 6,
  coldstart_answer: 8,
};

const STATE_CHANGE_EVENTS = new Set(["task_completed", "workspace_archived"]);

export function eventToObservation(event: WorkspaceEvent): AddObservationInput {
  return {
    type: "signal",
    key: `workspace:${event.event_type}`,
    value: event.payload,
    confidence: CONFIDENCE_BY_EVENT_TYPE[event.event_type] ?? 5,
    source: "workspace",
    provenance: JSON.stringify({
      workspace_id: event.workspace_id,
      task_id: event.task_id,
      origin: "workspace_event_bus",
    }),
  };
}

export interface StateChangeResult {
  shouldDerive: boolean;
  observations: AddObservationInput[];
}

export function processStateChange(
  store: WorkspaceStore,
  workspaceId: string,
  eventType: string,
  taskId?: string,
): StateChangeResult {
  const shouldDerive = STATE_CHANGE_EVENTS.has(eventType);

  try {
    const events = store.listEvents(workspaceId);
    const relevant = taskId
      ? events.filter((e) => e.task_id === taskId && e.event_type === eventType)
      : events.filter((e) => e.event_type === eventType);

    const observations = relevant.map(eventToObservation);

    return { shouldDerive, observations };
  } catch (err) {
    console.error(
      `[event-bus] Error processing state change: ${(err as Error).message}`,
    );
    return { shouldDerive: false, observations: [] };
  }
}
