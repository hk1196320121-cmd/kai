import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Observer } from "../../core/orchestrator/observer";
import { recommendTasks } from "../../core/orchestrator/recommend";
import type { OrchestratorStore } from "../../core/orchestrator/store";
import type { PlannedTask } from "../../core/orchestrator/types";
import type { ProfileEngine } from "../../core/profile/engine";
import type { TelemetryRecorder } from "../../core/telemetry/recorder";
import { ExecutionStatusSchema } from "../orchestrator-schema";
import { WorkRecommendSchema } from "../schema";
import { log, textContent } from "../utils";

interface PlanningDeps {
  store: OrchestratorStore;
  profileEngine: ProfileEngine;
  telemetry: TelemetryRecorder | null;
}

export function registerPlanningHandlers(
  server: McpServer,
  deps: PlanningDeps,
): void {
  const { store, profileEngine, telemetry } = deps;

  // --- kai_execution_status ---
  server.tool(
    "kai_execution_status",
    ExecutionStatusSchema,
    async ({ idea_id, task_id, feedback }) => {
      log("kai_execution_status", {
        idea_id,
        task_id,
        hasFeedback: !!feedback,
      });

      const observer = new Observer(store, profileEngine, telemetry);

      if (feedback) {
        const results = task_id
          ? store.getResultsByTask(task_id)
          : idea_id
            ? store.getResultsByIdea(idea_id)
            : [];
        if (results.length > 0) {
          observer.processFeedback(results[0].id, feedback);
        }
      }

      let tasks: PlannedTask[] = [];
      if (idea_id) tasks = store.getTasksByIdea(idea_id);
      else if (task_id) {
        const task = store.getTask(task_id);
        if (task) tasks = [task];
      }

      const results = idea_id
        ? store.getResultsByIdea(idea_id)
        : store.getResultsByTaskIds(tasks.map((t) => t.id));
      const sinceDate = idea_id
        ? (store.getIdea(idea_id)?.created_at ?? new Date().toISOString())
        : "";
      const profileUpdates = idea_id
        ? observer.getProfileUpdates(sinceDate)
        : [];

      return textContent({
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          type: t.type,
          retry_count: t.retry_count,
        })),
        results: results.map((r) => ({
          id: r.id,
          success: Boolean(r.success),
          duration_ms: r.duration_ms,
          completed_at: r.completed_at,
        })),
        profile_updates: profileUpdates,
      });
    },
  );

  // --- kai_work_recommend ---
  server.tool(
    "kai_work_recommend",
    WorkRecommendSchema,
    async ({ domain, limit }) => {
      log("kai_work_recommend", { domain, limit });
      const traits = profileEngine.getTraits();
      const recommendations = recommendTasks(traits, domain).slice(0, limit);
      return textContent({ recommendations });
    },
  );
}
