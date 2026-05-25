import { createInterface } from "node:readline";
import type { Command } from "commander";
import { Derivator } from "../core/profile/derivator";
import { InterviewEngine } from "../core/profile/interview";
import { QUESTIONS } from "../core/profile/interview-questions";
import { WorkspaceStore } from "../workspace/store";
import { renderRecommendations } from "./renderers/recommendations";
import { handleWorkStatus, handleWorkList } from "./work/status";
import { getEngine } from "./utils";
import { scanGitHistory, type GitScanResult } from "./work/git-scan";
import { progress, progressDone, displayPreview } from "./work/ui";
import { runRecommendations, getIdeaRecommendations } from "./work/recommendations";


// --- Re-exports from extracted modules ---

export { scanGitHistory, type GitScanResult } from "./work/git-scan";

// --- CLI Commands ---

export function registerWorkCommands(program: Command): void {
  const work = program.command("work").description("Workspace management");

  work
    .command("start")
    .description("Start a new workspace with cold start profile bootstrapping")
    .option("--reset", "Force re-interview even if coldstart data exists")
    .action(async (options: { reset?: boolean }) => {
      const { db, engine } = getEngine();

      // --reset: clear existing coldstart observations
      if (options.reset) {
        const existingObs = engine.getObservations({ type: "signal" });
        const raw = db.getDatabase();
        for (const obs of existingObs) {
          if (obs.source === "coldstart") {
            raw.query("DELETE FROM observations WHERE id = $id").run({
              $id: obs.id,
            });
          }
        }
        console.log("Cleared existing cold start data.");
      }

      // Check/create identity (merged bootstrap per D2)
      let identity = engine.getIdentity();
      if (!identity) {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const ask = (q: string): Promise<string> =>
          new Promise((r) => rl.question(q, r));

        console.log("First, let's set up your identity.\n");
        const name = (await ask("What's your name? ")).trim();
        const role = (await ask("What's your role? ")).trim();

        if (!name) {
          console.log("Name is required. Aborting.");
          rl.close();
          db.close();
          return;
        }

        engine.createIdentity({
          name,
          role: role || "developer",
        });
        identity = engine.getIdentity();
        console.log(`\nWelcome, ${identity?.name}!\n`);
        rl.close();
      }

      // Re-run detection: skip interview if interview answers already exist
      // Only check for interview answers (coldstart:goal is the required first question),
      // not git scan observations which are written before the interview and could remain
      // if the interview is interrupted.
      const existingAnswers = engine.getObservations({ key: "coldstart:goal" });
      if (existingAnswers.length > 0 && !options.reset) {
        console.log(
          "Cold start already completed. Showing recommendations from existing profile...",
        );
        const { recommendations } = getIdeaRecommendations(engine);

        if (recommendations.length === 0) {
          console.log("\nNo matching workflows found for your profile.");
          db.close();
          return;
        }

        console.log(
          renderRecommendations(recommendations, { showHint: false }),
        );

        db.close();
        return;
      }

      // Step 1: Git scan
      progress("Scanning git history");
      const gitResult = scanGitHistory(process.cwd());
      progressDone("Git scan complete");

      for (const obs of gitResult.observations) {
        engine.addObservation(obs);
      }

      // Step 2: Create workspace
      const store = new WorkspaceStore(db);
      const workspace = store.createWorkspace({
        name: `Cold Start - ${new Date().toISOString().slice(0, 10)}`,
        description: "Workspace created during cold start",
      });

      // SIGINT handler for cleanup
      let cancelled = false;
      const onSigInt = () => {
        cancelled = true;
        console.log("\n\nCleaning up...");
        store.deleteWorkspace(workspace.id);
        console.log("Workspace deleted. Aborted.");
        db.close();
        process.exit(130);
      };
      process.on("SIGINT", onSigInt);

      // Step 3: 10-question flow using imported QUESTIONS
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const ask = (q: string): Promise<string> =>
        new Promise((r) => rl.question(q, r));

      console.log(`\nWorkspace: ${workspace.id}\n`);

      const answers: { slug: string; text: string }[] = [];
      for (const q of QUESTIONS) {
        let promptText = q.prompt;
        if (q.options && q.options.length > 0) {
          promptText += `\n  ${q.options.map((o) => `▸ ${o}`).join("    ")}\n> `;
        } else {
          promptText += "\n> ";
        }

        let answer = (await ask(promptText)).trim();

        if (!answer && q.required) {
          console.log("This one's required.");
          answer = (await ask(promptText)).trim();
          if (!answer) {
            console.log("Required answer missing. Cleaning up and aborting.");
            store.deleteWorkspace(workspace.id);
            rl.close();
            process.removeListener("SIGINT", onSigInt);
            db.close();
            return;
          }
        }

        answers.push({ slug: q.slug, text: answer });

        store.addEvent({
          workspace_id: workspace.id,
          event_type: "coldstart_answer",
          payload: JSON.stringify({ slug: q.slug, text: answer }),
        });
      }

      rl.close();
      process.removeListener("SIGINT", onSigInt);

      if (cancelled) return;

      // Step 4: Signal extraction via InterviewEngine
      progress("Extracting signals");
      const interview = new InterviewEngine();
      const signals = interview.extractSignalsFromAnswers(
        answers,
        gitResult.traits,
        workspace.id,
      );
      progressDone(`Extracted ${signals.length} signals`);
      for (const obs of signals) {
        engine.addObservation(obs);
      }

      // Step 5: Derive traits in-memory (preview mode)
      progress("Deriving traits");
      const derivator = new Derivator(engine);
      const previewTraits = derivator.deriveFromRules(false);
      progressDone(`Derived ${previewTraits.length} traits`);

      if (previewTraits.length === 0) {
        console.log(
          "\nCouldn't derive any traits from your answers. Try `kai profile derive` later.",
        );
        store.deleteWorkspace(workspace.id);
        db.close();
        return;
      }

      // Step 6: Show preview
      displayPreview(previewTraits, gitResult.traits);

      // Step 7: Confirm/edit/restart loop
      const confirmRl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const confirmAsk = (q: string): Promise<string> =>
        new Promise((r) => confirmRl.question(q, r));

      let confirmed = false;
      while (!confirmed && !cancelled) {
        const response = (await confirmAsk("> ")).trim().toLowerCase() || "y";

        if (response === "y" || response === "yes") {
          for (const trait of previewTraits) {
            engine.setTrait(trait);
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
            await confirmAsk("Which trait? (dimension name) ")
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
            await confirmAsk(`  Value (0.0-1.0, current: ${trait.value}): `)
          ).trim();
          const newConf = (
            await confirmAsk(
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
          store.deleteWorkspace(workspace.id);
          confirmRl.close();
          db.close();
          return;
        } else {
          console.log("  Please enter [Y]es, [E]dit, or [R]estart");
        }
      }

      // Step 8: Show recommendations and auto-execute
      if (confirmed) {
        confirmRl.close();
        await runRecommendations(db, engine, store, workspace, previewTraits);
        db.close();
        return;
      }

      confirmRl.close();
      db.close();
    });

  work
    .command("status")
    .description("Show current workspace status")
    .action(() => {
      handleWorkStatus();
    });

  work
    .command("list")
    .description("List all workspaces")
    .action(() => {
      handleWorkList();
    });
}
