import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HermesAgentBridge } from "../bridge/agent-bridge";
import { ClosedLoopEngine } from "../core/orchestrator/closed-loop";
import { IdeaClusterer } from "../core/orchestrator/clustering";
import { Dispatcher } from "../core/orchestrator/dispatcher";
import { Observer } from "../core/orchestrator/observer";
import { Planner } from "../core/orchestrator/planner";
import { Scheduler } from "../core/orchestrator/scheduler";
import { OrchestratorStore } from "../core/orchestrator/store";
import type { PlannedTask } from "../core/orchestrator/types";
import { ProfileEngine } from "../core/profile/engine";
import { GeneStore } from "../core/prompt/gene-store";
import { PromptCompiler } from "../core/prompt/prompt-compiler";
import type { KaiDB } from "../db/client";
import { LLMProvider } from "../llm/provider";
import { WorkspaceStore } from "../workspace/store";
import {
  ExecutionStatusSchema,
  IdeaPauseSchema,
  IdeaPlanSchema,
  IdeaSubmitSchema,
  PlanApproveSchema,
  ReplanSchema,
  TaskExecuteSchema,
} from "./orchestrator-schema";
import { log } from "./utils";

const ALLOWED_UPDATE_FIELDS = [
  "title",
  "prompt",
  "cron_schedule",
  "agent",
  "type",
] as const;

const CRON_FORMAT =
  /^[0-9*,/-]+\s+[0-9*,/-]+\s+[0-9*,/-]+\s+[0-9*,/-]+\s+[0-9*,/-]+$/;

function textContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function registerOrchestratorHandlers(
  server: McpServer,
  db: KaiDB,
): void {
  const profileEngine = new ProfileEngine(db);
  const store = new OrchestratorStore(db);
  const workspaceStore = new WorkspaceStore(db);
  const llmProvider = new LLMProvider();
  const bridge = new HermesAgentBridge();
  const _closedLoopEngine = new ClosedLoopEngine(profileEngine, store);
  const geneStore = new GeneStore(db);
  const promptCompiler = new PromptCompiler(geneStore);

  // --- kai_idea_submit ---
  server.tool("kai_idea_submit", IdeaSubmitSchema, async (params) => {
    log("kai_idea_submit", { title: params.title });

    let workspaceId = params.workspace_id;
    if (!workspaceId) {
      const ws = workspaceStore.createWorkspace({
        name: params.title,
        description: `Auto-created for idea: ${params.title}`,
      });
      workspaceStore.updateWorkspaceContext(ws.id, { auto_created: true });
      workspaceId = ws.id;
    }

    const idea = store.createIdea({
      title: params.title,
      description: params.description,
      domain: params.domain,
      priority: params.priority,
      deadline: params.deadline,
      workspace_id: workspaceId,
    });

    const clusterer = new IdeaClusterer(profileEngine, store);
    const clusters = clusterer.detectClusters();

    return textContent({
      idea_id: idea.id,
      workspace_id: workspaceId,
      status: idea.status,
      suggested_clusters: clusters.slice(0, 3),
    });
  });

  // --- kai_idea_plan ---
  server.tool("kai_idea_plan", IdeaPlanSchema, async ({ idea_id }) => {
    log("kai_idea_plan", { idea_id });

    const idea = store.getIdea(idea_id);
    if (!idea) return textContent({ error: "idea_not_found" });

    const traits = profileEngine.getTraits();
    const planner = new Planner(store, llmProvider, promptCompiler);

    try {
      const tasks = await planner.decomposeIdea(idea_id, traits);
      store.updateIdeaStatus(idea_id, "planned");

      return textContent({
        idea: { id: idea.id, title: idea.title, domain: idea.domain },
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          type: t.type,
          agent: t.agent,
          prompt: t.prompt,
          decomposition_rationale: t.decomposition_rationale,
          cron_schedule: t.cron_schedule,
          status: t.status,
        })),
        profile_influence: traits.slice(0, 5).map((t) => ({
          dimension: t.dimension,
          value: t.value,
        })),
      });
    } catch {
      return textContent({
        error: "planning_failed",
        message: "Failed to decompose idea into tasks",
      });
    }
  });

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
    const dispatcher = new Dispatcher(store, bridge);
    const result = await dispatcher.dispatch(task_id);
    return textContent({
      success: result.success,
      task_id,
      agent: "hermes",
      error: result.error,
    });
  });

  // --- kai_idea_pause ---
  server.tool("kai_idea_pause", IdeaPauseSchema, async ({ idea_id }) => {
    log("kai_idea_pause", { idea_id });
    const scheduler = new Scheduler(store, bridge);
    const result = await scheduler.pauseTasks(idea_id);
    return textContent({
      paused_tasks: result.paused,
      cancelled_cron_jobs: result.cancelled,
    });
  });

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

      const observer = new Observer(store, profileEngine);

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

  // --- kai_replan ---
  server.tool("kai_replan", ReplanSchema, async ({ idea_id }) => {
    log("kai_replan", { idea_id });

    const idea = store.getIdea(idea_id);
    if (!idea) return textContent({ error: "idea_not_found" });

    const oldTasks = store.getTasksByIdea(idea_id);
    for (const t of oldTasks) {
      if (t.status !== "completed" && t.status !== "failed") {
        store.deleteTask(t.id);
      }
    }
    const traits = profileEngine.getTraits();
    const planner = new Planner(store, llmProvider, promptCompiler);

    try {
      const newTasks = await planner.decomposeIdea(idea_id, traits);
      return textContent({
        new_plan: newTasks.map((t) => ({
          id: t.id,
          title: t.title,
          type: t.type,
          status: t.status,
        })),
        changes_from_previous: {
          old_count: oldTasks.length,
          new_count: newTasks.length,
        },
      });
    } catch {
      return textContent({
        error: "replan_failed",
        message: "Failed to re-plan idea",
      });
    }
  });
}
