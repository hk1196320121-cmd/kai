import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentBridge } from "../../bridge/agent-bridge";
import { Dispatcher } from "../../core/orchestrator/dispatcher";
import { Scheduler } from "../../core/orchestrator/scheduler";
import type { OrchestratorStore } from "../../core/orchestrator/store";
import type { ProfileEngine } from "../../core/profile/engine";
import type { TelemetryRecorder } from "../../core/telemetry/recorder";
import {
  DispatchFeedbackSchema,
  PlanApproveSchema,
  TaskExecuteSchema,
} from "../orchestrator-schema";
import { log, textContent } from "../utils";
import { ALLOWED_UPDATE_FIELDS, CRON_FORMAT } from "./utils";

/** Default confidence for Phase 1 dispatch routing decisions. */
const DEFAULT_DISPATCH_CONFIDENCE = 0.8;
/** Default reasoning for Phase 1 dispatch routing decisions. */
const DEFAULT_ROUTING_REASONING = "Phase 1 default routing";

interface TaskDeps {
  store: OrchestratorStore;
  profileEngine: ProfileEngine;
  bridge: AgentBridge;
  telemetry: TelemetryRecorder | null;
}

export function registerTaskHandlers(server: McpServer, deps: TaskDeps): void {
  const { store, profileEngine, bridge, telemetry } = deps;

  // --- kai_plan_approve ---
  server.tool(
    "kai_plan_approve",
    PlanApproveSchema,
    async ({ idea_id, task_modifications }) => {
      log("kai_plan_approve", { idea_id });

      const idea = store.getIdea(idea_id);
      if (!idea) return textContent({ error: "idea_not_found" });

      if (task_modifications) {
        for (const mod of task_modifications) {
          if (mod.task_id) {
            const task = store.getTask(mod.task_id);
            if (!task || task.idea_id !== idea_id) {
              return textContent({
                error: "task_not_found",
                message: `Task ${mod.task_id} does not belong to idea ${idea_id}`,
              });
            }
          }
          if (mod.action === "remove" && mod.task_id) {
            store.deleteTask(mod.task_id);
          } else if (
            mod.action === "update" &&
            mod.task_id &&
            mod.field &&
            mod.value
          ) {
            if (
              !(ALLOWED_UPDATE_FIELDS as readonly string[]).includes(mod.field)
            ) {
              return textContent({
                error: "invalid_field",
                message: `Field '${mod.field}' is not allowed for update`,
              });
            }
            if (mod.field === "cron_schedule" && !CRON_FORMAT.test(mod.value)) {
              return textContent({
                error: "invalid_cron",
                message: `Invalid cron_schedule format: ${mod.value}`,
              });
            }
            store.updateTask(mod.task_id, { [mod.field]: mod.value });
          } else if (mod.action === "add") {
            return textContent({
              error: "unsupported_action",
              message: "'add' modification is not yet supported",
            });
          }
        }
      }

      const traits = profileEngine.getTraits();
      const scheduler = new Scheduler(store, bridge);
      const result = await scheduler.scheduleTasks(idea_id, traits);

      return textContent({
        scheduled_tasks: result.scheduled,
        errors: result.errors,
        tasks: store.getTasksByIdea(idea_id).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          type: t.type,
        })),
      });
    },
  );

  // --- kai_task_execute ---
  server.tool("kai_task_execute", TaskExecuteSchema, async ({ task_id }) => {
    log("kai_task_execute", { task_id });
    try {
      const task = store.getTask(task_id);
      if (!task) {
        return textContent({
          success: false,
          task_id,
          error: "Task not found",
        });
      }

      const dispatcher = new Dispatcher(store, bridge, telemetry);
      const result = await dispatcher.dispatch(task_id);

      // C3 fix: record dispatch decision AFTER dispatch completes (not before)
      // to avoid orphan rows for tasks that fail validation (completed, max retries, cron)
      const dispatchId = randomUUID();
      store.createDispatchDecision({
        id: dispatchId,
        task_id,
        agent: task.agent,
        confidence: DEFAULT_DISPATCH_CONFIDENCE,
        reasoning: DEFAULT_ROUTING_REASONING,
      });

      return textContent({
        success: result.success,
        task_id,
        dispatch_id: dispatchId,
        agent: result.agent,
        error: result.error,
        output: result.output,
      });
    } catch {
      // C10 fix: return generic error, don't leak internal details
      return textContent({
        success: false,
        task_id,
        error: "INTERNAL_ERROR: request failed",
      });
    }
  });

  // --- kai_dispatch_feedback ---
  server.tool(
    "kai_dispatch_feedback",
    DispatchFeedbackSchema,
    async ({ dispatch_id, decision, reason }) => {
      log("kai_dispatch_feedback", { dispatch_id, decision });

      try {
        const row = store.getDispatchDecision(dispatch_id);
        if (!row) {
          return textContent({ success: false, error: "dispatch_not_found" });
        }

        // C9 fix: prevent double-vote — only pending decisions can be updated
        if (row.user_decision !== "pending") {
          return textContent({
            success: false,
            error: "dispatch_already_decided",
          });
        }

        store.updateDispatchDecision(dispatch_id, decision, reason ?? null);

        // Emit feedback observation via ProfileEngine (best-effort)
        try {
          profileEngine.addObservation({
            type: "feedback",
            key: `dispatch:feedback:${dispatch_id}`,
            value: JSON.stringify({ decision, reason }),
            confidence: decision === "approved" ? 7 : 4,
            source: "execution_result",
            provenance: JSON.stringify({
              source: "dispatch_feedback",
              extracted_at: new Date().toISOString(),
            }),
          });
        } catch {
          // Observation emission is best-effort; don't fail the feedback response
        }

        return textContent({
          dispatch_id,
          decision,
          recorded: true,
        });
      } catch {
        return textContent({
          success: false,
          error: "INTERNAL_ERROR: request failed",
        });
      }
    },
  );
}
