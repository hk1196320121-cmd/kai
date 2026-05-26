import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline";
import { Derivator } from "../../core/profile/derivator";
import { InterviewEngine } from "../../core/profile/interview";
import { QUESTIONS } from "../../core/profile/interview-questions";
import { WorkspaceStore } from "../../workspace/store";
import { renderRecommendations } from "../renderers/recommendations";
import { getEngine } from "../utils";
import { scanGitHistory } from "./git-scan";
import { getIdeaRecommendations, runRecommendations } from "./recommendations";
import type { PhaseResult, WorkStartContext, WorkStartOptions } from "./types";
import { displayPreview, progress, progressDone } from "./ui";

// --- Helpers ---

interface ReadlineTracker {
  current?: ReadlineInterface;
}

function ask(rl: ReadlineInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function deleteColdstartObservations(db: WorkStartContext["db"]): void {
  const raw = db.getDatabase();
  raw.query("DELETE FROM observations WHERE source = $source").run({
    $source: "coldstart",
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

  deleteColdstartObservations(ctx.db);
  console.log("Cleared existing cold start data.");
  return { status: "continue" };
}

async function ensureIdentity(
  ctx: WorkStartContext,
  rlTracker: ReadlineTracker,
): Promise<PhaseResult> {
  const identity = ctx.engine.getIdentity();
  if (identity) {
    return { status: "continue", context: { identity } };
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rlTracker.current = rl;
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
    rlTracker.current = undefined;
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
      return { status: "abort", context: { completed: true } };
    }

    console.log(renderRecommendations(recommendations, { showHint: false }));
    return { status: "abort", context: { completed: true } };
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
  rlTracker: ReadlineTracker,
): Promise<PhaseResult> {
  const { store, workspace } = ctx;
  if (!store || !workspace) {
    return { status: "abort" };
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rlTracker.current = rl;

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
    rlTracker.current = undefined;
    rl.close();
    process.removeListener("SIGINT", onSigInt);
  }
}

async function deriveAndPreview(
  ctx: WorkStartContext,
  rlTracker: ReadlineTracker,
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
  rlTracker.current = confirmRl;

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
    rlTracker.current = undefined;
    confirmRl.close();
  }
}

// --- Main exported function ---

export async function handleWorkStart(
  options: WorkStartOptions,
): Promise<void> {
  // Cooperative SIGINT: set flag and close active readline to unblock pending asks
  let sigintReceived = false;
  const rlTracker: ReadlineTracker = {};
  const onSigInt = () => {
    sigintReceived = true;
    if (rlTracker.current) rlTracker.current.close();
    console.log("\n\nCleaning up...");
  };
  process.on("SIGINT", onSigInt);

  let cleanupSigInt: (() => void) | undefined;
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
    result = await ensureIdentity(ctx, rlTracker);
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
    cleanupSigInt = () => {
      sigintReceived = true;
      if (rlTracker.current) rlTracker.current.close();
      console.log("\n\nCleaning up...");
      if (!ctx.completed && ctx.store && ctx.workspace) {
        ctx.store.deleteWorkspace(ctx.workspace.id);
        console.log("Workspace deleted. Aborted.");
      }
    };
    process.removeListener("SIGINT", onSigInt);
    process.on("SIGINT", cleanupSigInt);

    // Phase 6: interview
    if (sigintReceived) return;
    result = await runInterview(ctx, cleanupSigInt, rlTracker);
    Object.assign(ctx, result.context);
    if (result.status === "abort") return;

    // Re-register SIGINT after interview removes it in its finally block
    if (cleanupSigInt && !process.listeners("SIGINT").includes(cleanupSigInt)) {
      process.on("SIGINT", cleanupSigInt);
    }

    // Phase 7: derive and preview
    if (sigintReceived) return;
    result = await deriveAndPreview(ctx, rlTracker);
    Object.assign(ctx, result.context);
    if (result.status === "abort") return;

    // Phase 8: recommendations
    if (ctx.completed && ctx.store && ctx.workspace && ctx.previewTraits) {
      await runRecommendations(ctx.db, ctx.engine, ctx.store, ctx.workspace);
    }
  } finally {
    // Centralized cleanup
    process.removeListener("SIGINT", onSigInt);
    if (cleanupSigInt) process.removeListener("SIGINT", cleanupSigInt);

    // Delete workspace and coldstart data if not completed
    if (!ctx.completed) {
      if (ctx.store && ctx.workspace) {
        try {
          ctx.store.deleteWorkspace(ctx.workspace.id);
        } catch {
          // best effort cleanup
        }
      }
      // Clean coldstart observations so restart gets a fresh slate
      try {
        deleteColdstartObservations(ctx.db);
      } catch {
        // best effort cleanup
      }
    }

    ctx.db.close();
  }
}
