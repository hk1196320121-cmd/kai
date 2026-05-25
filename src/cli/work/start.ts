import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline";
import { Derivator } from "../../core/profile/derivator";
import { InterviewEngine } from "../../core/profile/interview";
import { QUESTIONS } from "../../core/profile/interview-questions";
import { WorkspaceStore } from "../../workspace/store";
import { renderError } from "../format";
import { renderRecommendations } from "../renderers/recommendations";
import { getEngine } from "../utils";
import { type GitScanResult, scanGitHistory } from "./git-scan";
import { getIdeaRecommendations, runRecommendations } from "./recommendations";
import type { PhaseResult, WorkStartContext, WorkStartOptions } from "./types";
import { displayPreview, progress, progressDone } from "./ui";

// --- Helpers ---

function ask(rl: ReadlineInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// --- Phase functions ---

async function resetColdstartData(
  ctx: WorkStartContext,
  options: WorkStartOptions,
): Promise<PhaseResult> {
  if (!options.reset) {
    return { status: "continue" };
  }

  const existingObs = ctx.engine.getObservations({ type: "signal" });
  const raw = ctx.db.getDatabase();
  for (const obs of existingObs) {
    if (obs.source === "coldstart") {
      raw.query("DELETE FROM observations WHERE id = $id").run({
        $id: obs.id,
      });
    }
  }
  console.log("Cleared existing cold start data.");
  return { status: "continue" };
}

async function ensureIdentity(ctx: WorkStartContext): Promise<PhaseResult> {
  const identity = ctx.engine.getIdentity();
  if (identity) {
    return { status: "continue", context: { identity } };
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    console.log("First, let's set up your identity.\n");
    const name = (await ask(rl, "What's your name? ")).trim();
    const role = (await ask(rl, "What's your role? ")).trim();

    if (!name) {
      console.log("Name is required. Aborting.");
      return { status: "abort" };
    }

    ctx.engine.createIdentity({
      name,
      role: role || "developer",
    });
    const created = ctx.engine.getIdentity();
    console.log(`\nWelcome, ${created?.name}!\n`);
    return { status: "continue", context: { identity: created ?? undefined } };
  } finally {
    rl.close();
  }
}

async function checkRerun(
  ctx: WorkStartContext,
  options: WorkStartOptions,
): Promise<PhaseResult> {
  const existingAnswers = ctx.engine.getObservations({
    key: "coldstart:goal",
  });
  if (existingAnswers.length > 0 && !options.reset) {
    console.log(
      "Cold start already completed. Showing recommendations from existing profile...",
    );
    const { recommendations } = getIdeaRecommendations(ctx.engine);

    if (recommendations.length === 0) {
      console.log("\nNo matching workflows found for your profile.");
      return { status: "abort" };
    }

    console.log(renderRecommendations(recommendations, { showHint: false }));
    return { status: "abort" };
  }
  return { status: "continue" };
}

async function gitScan(ctx: WorkStartContext): Promise<PhaseResult> {
  progress("Scanning git history");
  const gitResult = scanGitHistory(process.cwd());
  progressDone("Git scan complete");

  for (const obs of gitResult.observations) {
    ctx.engine.addObservation(obs);
  }

  return { status: "continue", context: { gitResult } };
}

async function createWorkspace(ctx: WorkStartContext): Promise<PhaseResult> {
  const store = new WorkspaceStore(ctx.db);
  const workspace = store.createWorkspace({
    name: `Cold Start - ${new Date().toISOString().slice(0, 10)}`,
    description: "Workspace created during cold start",
  });
  return { status: "continue", context: { store, workspace } };
}

async function runInterview(
  ctx: WorkStartContext,
  onSigInt: () => void,
): Promise<PhaseResult> {
  const { store, workspace } = ctx;
  if (!store || !workspace) {
    return { status: "abort" };
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(`\nWorkspace: ${workspace.id}\n`);

    const answers: { slug: string; text: string }[] = [];
    for (const q of QUESTIONS) {
      let promptText = q.prompt;
      if (q.options && q.options.length > 0) {
        promptText += `\n  ${q.options.map((o) => `▸ ${o}`).join("    ")}\n> `;
      } else {
        promptText += "\n> ";
      }

      let answer = (await ask(rl, promptText)).trim();

      if (!answer && q.required) {
        console.log("This one's required.");
        answer = (await ask(rl, promptText)).trim();
        if (!answer) {
          console.log("Required answer missing. Cleaning up and aborting.");
          return { status: "abort", context: { answers } };
        }
      }

      answers.push({ slug: q.slug, text: answer });

      store.addEvent({
        workspace_id: workspace.id,
        event_type: "coldstart_answer",
        payload: JSON.stringify({ slug: q.slug, text: answer }),
      });
    }

    return { status: "continue", context: { answers } };
  } finally {
    rl.close();
    process.removeListener("SIGINT", onSigInt);
  }
}

async function deriveAndPreview(
  ctx: WorkStartContext,
  onSigInt: () => void,
): Promise<PhaseResult> {
  const { store, workspace, gitResult, answers } = ctx;
  if (!store || !workspace || !gitResult || !answers) {
    return { status: "abort" };
  }

  // Signal extraction via InterviewEngine
  progress("Extracting signals");
  const interview = new InterviewEngine();
  const signals = interview.extractSignalsFromAnswers(
    answers,
    gitResult.traits,
    workspace.id,
  );
  progressDone(`Extracted ${signals.length} signals`);
  for (const obs of signals) {
    ctx.engine.addObservation(obs);
  }

  // Derive traits in-memory (preview mode)
  progress("Deriving traits");
  const derivator = new Derivator(ctx.engine);
  const previewTraits = derivator.deriveFromRules(false);
  progressDone(`Derived ${previewTraits.length} traits`);

  if (previewTraits.length === 0) {
    console.log(
      "\nCouldn't derive any traits from your answers. Try `kai profile derive` later.",
    );
    return { status: "abort" };
  }

  // Show preview
  displayPreview(previewTraits, gitResult.traits);

  // Confirm/edit/restart loop
  const confirmRl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    let confirmed = false;
    while (!confirmed) {
      const response = (await ask(confirmRl, "> ")).trim().toLowerCase() || "y";

      if (response === "y" || response === "yes") {
        for (const trait of previewTraits) {
          ctx.engine.setTrait(trait);
        }

        store.updateWorkspaceContext(workspace.id, {
          profile_snapshot: previewTraits.map((t) => ({
            dimension: t.dimension,
            value: t.value,
            confidence: t.confidence,
            reasoning: t.reasoning,
          })),
          coldstart_completed_at: new Date().toISOString(),
        });

        console.log(`\n✓ Workspace created: ${workspace.id}`);
        console.log(`✓ Profile saved (${previewTraits.length} traits)`);
        console.log(
          `✓ Ready to work. Use \`kai work status\` to see your workspace.`,
        );
        confirmed = true;
      } else if (response === "e" || response === "edit") {
        const dim = (
          await ask(confirmRl, "Which trait? (dimension name) ")
        ).trim();
        const trait = previewTraits.find(
          (t) => t.dimension === dim || t.dimension.startsWith(dim),
        );
        if (!trait) {
          console.log(
            `  No trait matching "${dim}". Available: ${previewTraits.map((t) => t.dimension).join(", ")}`,
          );
          continue;
        }

        const newValue = (
          await ask(confirmRl, `  Value (0.0-1.0, current: ${trait.value}): `)
        ).trim();
        const newConf = (
          await ask(
            confirmRl,
            `  Confidence (1-10, current: ${trait.confidence}): `,
          )
        ).trim();

        if (newValue) {
          const parsed = Number.parseFloat(newValue);
          if (!Number.isNaN(parsed))
            trait.value = Math.max(0, Math.min(1, parsed));
        }
        if (newConf) {
          const parsed = Number.parseInt(newConf, 10);
          if (!Number.isNaN(parsed))
            trait.confidence = Math.max(1, Math.min(10, parsed));
        }

        console.log("\nUpdated preview:");
        displayPreview(previewTraits, gitResult.traits);
      } else if (response === "r" || response === "restart") {
        console.log("\nRestarting cold start...");
        return { status: "abort", context: { previewTraits } };
      } else {
        console.log("  Please enter [Y]es, [E]dit, or [R]estart");
      }
    }

    return {
      status: "continue",
      context: { previewTraits, completed: confirmed },
    };
  } finally {
    confirmRl.close();
  }
}

// --- Main exported function ---

export async function handleWorkStart(
  options: WorkStartOptions,
): Promise<void> {
  // Cooperative SIGINT: set flag, let readline reject, flow reaches finally
  let sigintReceived = false;
  const onSigInt = () => {
    sigintReceived = true;
    console.log("\n\nCleaning up...");
  };
  process.on("SIGINT", onSigInt);

  const { db, engine } = getEngine();
  const ctx: WorkStartContext = { db, engine, completed: false };

  try {
    // Phase 1: reset coldstart data
    if (sigintReceived) return;
    let result = await resetColdstartData(ctx, options);
    Object.assign(ctx, result.context);
    if (result.status === "abort") return;

    // Phase 2: ensure identity
    if (sigintReceived) return;
    result = await ensureIdentity(ctx);
    Object.assign(ctx, result.context);
    if (result.status === "abort") return;

    // Phase 3: check rerun
    if (sigintReceived) return;
    result = await checkRerun(ctx, options);
    Object.assign(ctx, result.context);
    if (result.status === "abort") return;

    // Phase 4: git scan
    if (sigintReceived) return;
    result = await gitScan(ctx);
    Object.assign(ctx, result.context);
    if (result.status === "abort") return;

    // Phase 5: create workspace
    if (sigintReceived) return;
    result = await createWorkspace(ctx);
    Object.assign(ctx, result.context);
    if (result.status === "abort") return;

    // Register SIGINT handler that deletes workspace (after workspace exists)
    const cleanupSigInt = () => {
      sigintReceived = true;
      console.log("\n\nCleaning up...");
      if (ctx.store && ctx.workspace) {
        ctx.store.deleteWorkspace(ctx.workspace.id);
      }
      console.log("Workspace deleted. Aborted.");
    };
    process.removeListener("SIGINT", onSigInt);
    process.on("SIGINT", cleanupSigInt);

    // Phase 6: interview
    if (sigintReceived) return;
    result = await runInterview(ctx, cleanupSigInt);
    Object.assign(ctx, result.context);
    if (result.status === "abort") return;

    // Re-register SIGINT after interview removes it
    process.on("SIGINT", cleanupSigInt);

    // Phase 7: derive and preview
    if (sigintReceived) return;
    result = await deriveAndPreview(ctx, cleanupSigInt);
    Object.assign(ctx, result.context);
    if (result.status === "abort") return;

    // Phase 8: recommendations
    if (ctx.completed && ctx.store && ctx.workspace && ctx.previewTraits) {
      await runRecommendations(
        ctx.db,
        ctx.engine,
        ctx.store,
        ctx.workspace,
        ctx.previewTraits,
      );
    }
  } finally {
    // Centralized cleanup
    process.removeListener("SIGINT", onSigInt);

    // Delete workspace if not completed
    if (!ctx.completed && ctx.store && ctx.workspace) {
      try {
        ctx.store.deleteWorkspace(ctx.workspace.id);
      } catch {
        // best effort cleanup
      }
    }

    ctx.db.close();
  }
}
