import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentBridge } from "../../bridge/agent-bridge";
import { IdeaClusterer } from "../../core/orchestrator/clustering";
import { Planner } from "../../core/orchestrator/planner";
import { Scheduler } from "../../core/orchestrator/scheduler";
import type { OrchestratorStore } from "../../core/orchestrator/store";
import type { ProfileEngine } from "../../core/profile/engine";
import type { PromptCompiler } from "../../core/prompt/prompt-compiler";
import type { TelemetryRecorder } from "../../core/telemetry/recorder";
import type { LLMProvider } from "../../llm/provider";
import type { WorkspaceStore } from "../../workspace/store";
import {
  IdeaPauseSchema,
  IdeaPlanSchema,
  IdeaSubmitSchema,
  ReplanSchema,
} from "../orchestrator-schema";
import { log, textContent } from "../utils";

interface IdeaDeps {
  store: OrchestratorStore;
  workspaceStore: WorkspaceStore;
  profileEngine: ProfileEngine;
  llmProvider: LLMProvider;
  bridge: AgentBridge;
  promptCompiler: PromptCompiler;
  telemetry: TelemetryRecorder | null;
}

export function registerIdeaHandlers(server: McpServer, deps: IdeaDeps): void {
  const {
    store,
    workspaceStore,
    profileEngine,
    llmProvider,
    bridge,
    promptCompiler,
    telemetry,
  } = deps;

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
    const planner = new Planner(store, llmProvider, promptCompiler, telemetry);

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
    const planner = new Planner(store, llmProvider, promptCompiler, telemetry);

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
