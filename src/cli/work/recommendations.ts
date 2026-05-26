import { createInterface } from "node:readline";
import { HermesAgentBridge } from "../../bridge/agent-bridge";
import { Dispatcher } from "../../core/orchestrator/dispatcher";
import { resolveIdeaDomain } from "../../core/orchestrator/domain-resolver";
import { recommendTasks } from "../../core/orchestrator/recommend";
import { OrchestratorStore } from "../../core/orchestrator/store";
import type { ProfileEngine } from "../../core/profile/engine";
import type { KaiDB } from "../../db/client";
import type { WorkspaceStore } from "../../workspace/store";
import type { Workspace } from "../../workspace/types";
import { renderError } from "../format";
import { renderRecommendations } from "../renderers/recommendations";

// --- Shared helper: resolve domain and get recommendations ---

export function getIdeaRecommendations(engine: ProfileEngine) {
  const savedTraits = engine.getTraits();
  const domainObs = engine.getObservations({
    key: "coldstart:signal.domain",
  });
  let domainValue = "general";
  if (domainObs.length > 0) {
    try {
      domainValue = JSON.parse(domainObs[0].value).domains?.[0] ?? "general";
    } catch {
      // malformed JSON — fall back to "general"
    }
  }
  const ideaDomain = resolveIdeaDomain(domainValue);
  return {
    recommendations: recommendTasks(savedTraits, ideaDomain),
    savedTraits,
    ideaDomain,
  };
}

// --- Full recommendation flow: display, approval, LLM dispatch, penalization ---

export async function runRecommendations(
  db: KaiDB,
  engine: ProfileEngine,
  store: WorkspaceStore,
  workspace: Workspace,
): Promise<void> {
  const { recommendations, savedTraits, ideaDomain } =
    getIdeaRecommendations(engine);

  if (recommendations.length === 0) {
    console.log("\nNo matching workflows found for your profile.");
    return;
  }

  console.log(renderRecommendations(recommendations, { showHint: false }));

  store.addEvent({
    workspace_id: workspace.id,
    event_type: "recommendation_shown",
    payload: JSON.stringify({
      recommendations: recommendations.map((r) => r.templateId),
    }),
  });

  console.log(
    "\nSelect: number (1-%d) to pick one, [A]ll to approve all, [N]o to skip",
    recommendations.length,
  );

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q: string): Promise<string> =>
    new Promise((r) => rl.question(q, r));

  try {
    const approveResponse = (await ask("> ")).trim().toLowerCase();

    // Determine which recommendations to process
    const selectedIdx = parseInt(approveResponse, 10) - 1;
    const selected: number[] =
      approveResponse === "a" || approveResponse === "all"
        ? recommendations.map((_, i) => i)
        : !Number.isNaN(selectedIdx) &&
            selectedIdx >= 0 &&
            selectedIdx < recommendations.length
          ? [selectedIdx]
          : [];

    // Only penalize when user explicitly skips ("n"/"no"), not on invalid input
    const explicitlySkipped =
      approveResponse === "n" || approveResponse === "no";

    if (selected.length > 0) {
      const orchStore = new OrchestratorStore(db);
      const { LLMProvider } = await import("../../llm/provider");
      const llm = new LLMProvider();
      const bridge = new HermesAgentBridge();
      const dispatcher = new Dispatcher(orchStore, bridge);

    for (const idx of selected) {
      const rec = recommendations[idx];

      const idea = orchStore.createIdea({
        title: rec.title,
        description: rec.description,
        domain: ideaDomain,
        workspace_id: workspace.id,
      });

      // Try LLM path for task decomposition
      let llmTasksCreated = false;
      if (llm.getConfig().apiKey) {
        try {
          const { GeneStore } = await import("../../core/prompt/gene-store");
          const { PromptCompiler } = await import(
            "../../core/prompt/prompt-compiler"
          );
          const geneStore = new GeneStore(db);
          const compiler = new PromptCompiler(geneStore);
          const { Planner } = await import("../../core/orchestrator/planner");
          const planner = new Planner(orchStore, llm, compiler);
          const tasks = await planner.decomposeIdea(idea.id, savedTraits);
          console.log(`\nPlan generated (${tasks.length} tasks):`);
          for (const t of tasks) {
            console.log(`  - ${t.title}`);
          }
          llmTasksCreated = tasks.length > 0;
        } catch (err) {
          console.error(renderError(err as Error));
          console.log(
            "  Could not generate plan (LLM unavailable), creating task directly.",
          );
        }
      }

      // Create fallback task only if LLM decomposition didn't produce tasks
      if (!llmTasksCreated) {
        const task = orchStore.createTask({
          idea_id: idea.id,
          workspace_id: workspace.id,
          title: rec.title,
          description: rec.description,
          type: "one_off",
          agent: "hermes",
          prompt: rec.description,
          decomposition_rationale:
            "Auto-generated from cold start recommendation",
          scheduling_rationale: "Execute when ready",
        });

        // Auto-execute via dispatcher
        try {
          const result = await dispatcher.dispatch(task.id);
          if (result.success) {
            console.log(`✓ Task dispatched: ${task.title}`);
            const wsTask = store.createTask({
              workspace_id: workspace.id,
              title: task.title,
              description: task.description,
            });
            store.addEvent({
              workspace_id: workspace.id,
              task_id: wsTask.id,
              event_type: "task_auto_executed",
              payload: JSON.stringify({
                planned_task_id: task.id,
                idea_id: idea.id,
              }),
            });
          }
        } catch (err) {
          console.error(renderError(err as Error));
          console.log(`  Task created but not dispatched (agent unavailable)`);
        }
      }

      store.addEvent({
        workspace_id: workspace.id,
        event_type: "recommendation_accepted",
        payload: JSON.stringify({
          template_id: rec.templateId,
        }),
      });
    }

    } // end if (selected.length > 0)

    // Emit rejection events for unselected recommendations + penalize confidence
    // Only when user explicitly skipped ("n"/"no"), not on empty/invalid input
    if (explicitlySkipped) {
      for (const rec of recommendations) {
        store.addEvent({
          workspace_id: workspace.id,
          event_type: "recommendation_rejected",
          payload: JSON.stringify({
            template_id: rec.templateId,
          }),
        });
      }

      // Penalize trait confidence for dimensions that drove rejected recommendations
      const rejectedDims = new Set<string>();
      for (const rec of recommendations) {
        if (rec.traitTargets) {
          for (const dim of Object.keys(rec.traitTargets)) {
            rejectedDims.add(dim);
          }
        }
      }
      const { ProfileEngine } = await import("../../core/profile/engine");
      const profileEngine = new ProfileEngine(db);
      for (const dim of rejectedDims) {
        const existing = profileEngine.getTraits({ dimension: dim });
        if (existing.length > 0 && existing[0].confidence > 1) {
          profileEngine.setTrait({
            dimension: dim,
            value: existing[0].value,
            confidence: Math.max(1, existing[0].confidence - 1),
            source: existing[0].source,
            reasoning: `${existing[0].reasoning} [confidence reduced: recommendation rejected]`,
          });
        }
      }
    } else if (selected.length === 0 && !explicitlySkipped) {
      console.log("\n  No selection made. Skipping recommendations.");
    }
  } finally {
    rl.close();
  }
}
