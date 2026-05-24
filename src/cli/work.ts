import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Command } from "commander";
import { HermesAgentBridge } from "../bridge/agent-bridge";
import { Dispatcher } from "../core/orchestrator/dispatcher";
import { resolveIdeaDomain } from "../core/orchestrator/domain-resolver";
import { recommendTasks } from "../core/orchestrator/recommend";
import { OrchestratorStore } from "../core/orchestrator/store";
import { Derivator } from "../core/profile/derivator";
import type { AddObservationInput } from "../core/profile/engine";
import { InterviewEngine } from "../core/profile/interview";
import { QUESTIONS } from "../core/profile/interview-questions";
import { WorkspaceStore } from "../workspace/store";
import { bar, renderError } from "./format";
import { renderRecommendations } from "./renderers/recommendations";
import {
  renderWorkspaceList,
  renderWorkspaceStatus,
} from "./renderers/workspace";
import { getEngine } from "./utils";

// --- Shared helper: resolve domain and get recommendations ---

function getIdeaRecommendations(
  engine: ReturnType<typeof getEngine>["engine"],
) {
  const savedTraits = engine.getTraits();
  const domainObs = engine.getObservations({
    key: "coldstart:signal.domain",
  });
  let domainValue = "general";
  if (domainObs.length > 0) {
    try {
      domainValue =
        JSON.parse(domainObs[0].value).domains?.[0] ?? "general";
    } catch (err) {
      console.error(renderError(err as Error));
    }
  }
  const ideaDomain = resolveIdeaDomain(domainValue);
  return {
    recommendations: recommendTasks(savedTraits, ideaDomain),
    savedTraits,
    ideaDomain,
  };
}

// --- Progress indicator (writes to stderr, gated by TTY + --json) ---

function progress(message: string): void {
  if (process.argv.includes("--json")) return;
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r\x1b[2K  ${message}...`);
}

function progressDone(message: string): void {
  if (process.argv.includes("--json")) return;
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r\x1b[2K  ${message}\n`);
}

// --- Git History Scanner ---

// Git scan thresholds
const MIN_GIT_COMMITS = 5;
const MORNING_HOUR_START = 5;
const MORNING_HOUR_END = 8;
const MORNING_RATIO_THRESHOLD = 0.3;
const DETAIL_LEVEL_HIGH_CHARS = 50;
const DETAIL_LEVEL_MED_CHARS = 20;

export interface GitScanResult {
  observations: AddObservationInput[];
  traits: { dimension: string; hints: string[] }[];
}

function makeProvenance(signalType?: string): string {
  return JSON.stringify({
    origin: "kai work start",
    extracted_at: new Date().toISOString(),
    extractor_version: "1.0.0",
    ...(signalType ? { signal_type: signalType } : {}),
  });
}

export function scanGitHistory(repoPath: string): GitScanResult {
  const observations: AddObservationInput[] = [];
  const traits: { dimension: string; hints: string[] }[] = [];

  const gitDir = join(repoPath, ".git");
  if (!existsSync(gitDir)) return { observations, traits };

  let logOutput: string;
  try {
    logOutput = execSync(
      'git log --oneline --since="30.days ago" --format="%H%x00%aI%x00%s"',
      { cwd: repoPath, encoding: "utf-8", timeout: 5000 },
    ).trim();
  } catch (err) {
    console.error(renderError(err as Error));
    return { observations, traits };
  }

  if (!logOutput) return { observations, traits };

  const lines = logOutput.split("\n");
  if (lines.length < MIN_GIT_COMMITS) return { observations, traits };

  // Commit time distribution -> early_riser / night_owl
  const hours: number[] = [];
  for (const line of lines) {
    const parts = line.split("\0");
    if (parts.length >= 2) {
      const match = parts[1].match(/T(\d{2}):/);
      if (match) hours.push(Number.parseInt(match[1], 10));
    }
  }

  if (hours.length > 0) {
    const morningCount = hours.filter(
      (h) => h >= MORNING_HOUR_START && h <= MORNING_HOUR_END,
    ).length;
    const morningRatio = morningCount / hours.length;

    observations.push({
      type: "signal",
      key: "coldstart:git.commit_time_distribution",
      value: JSON.stringify({
        morning_ratio: morningRatio,
        total_commits: hours.length,
      }),
      confidence: 4,
      source: "coldstart",
      provenance: makeProvenance("commit_time"),
    });

    if (morningRatio > MORNING_RATIO_THRESHOLD) {
      traits.push({
        dimension: "early_riser",
        hints: [`${Math.round(morningRatio * 100)}% morning commits`],
      });
    }
  }

  // Commit message avg length -> detail_oriented
  const msgLengths = lines.map((l) => {
    const parts = l.split("\0");
    return (parts[2] ?? "").length;
  });
  const avgLen = msgLengths.reduce((a, b) => a + b, 0) / msgLengths.length;

  observations.push({
    type: "signal",
    key: "coldstart:git.commit_message_length",
    value: JSON.stringify({
      avg_length: Math.round(avgLen),
      total_commits: lines.length,
      detail_level:
        avgLen > DETAIL_LEVEL_HIGH_CHARS
          ? "high"
          : avgLen > DETAIL_LEVEL_MED_CHARS
            ? "medium"
            : "low",
    }),
    confidence: 4,
    source: "coldstart",
    provenance: makeProvenance("commit_length"),
  });

  if (avgLen > DETAIL_LEVEL_HIGH_CHARS) {
    traits.push({
      dimension: "detail_oriented",
      hints: [`avg commit message ${Math.round(avgLen)} chars`],
    });
  }

  // Branch naming patterns -> scope_appetite
  let currentBranch = "";
  try {
    currentBranch = execSync("git branch --show-current", {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  } catch (err) {
    console.error(renderError(err as Error));
  }

  if (currentBranch) {
    const hasStructuredPrefix = /^(feat|fix|chore|docs|refactor)\//.test(
      currentBranch,
    );
    observations.push({
      type: "signal",
      key: "coldstart:git.branch_pattern",
      value: JSON.stringify({
        branch: currentBranch,
        structured: hasStructuredPrefix,
      }),
      confidence: 5,
      source: "coldstart",
      provenance: makeProvenance("branch_pattern"),
    });

    if (hasStructuredPrefix) {
      traits.push({
        dimension: "scope_appetite",
        hints: [`structured branch naming (${currentBranch.split("/")[0]}/*)`],
      });
    }
  }

  return { observations, traits };
}

// --- Profile Preview Display ---

function displayPreview(
  traits: import("../core/profile/derivator").DerivedTrait[],
  gitHints: { dimension: string; hints: string[] }[],
): void {
  console.log(
    `\n✓ Profile draft generated (${traits.length} traits detected):\n`,
  );

  const hintMap = new Map<string, string[]>();
  for (const h of gitHints) {
    const existing = hintMap.get(h.dimension) ?? [];
    hintMap.set(h.dimension, [...existing, ...h.hints]);
  }

  for (const t of traits) {
    const barStr = bar(t.value);
    const hints = hintMap.get(t.dimension);
    const hintStr = hints ? ` + ${hints.join(", ")}` : "";
    const reasoning =
      t.reasoning.length > 60 ? `${t.reasoning.slice(0, 57)}...` : t.reasoning;
    console.log(
      `  ${t.dimension.padEnd(22)}${barStr}  ${t.confidence}/10  — ${reasoning}${hintStr}`,
    );
  }

  console.log("\nLooks right? [Y]es / [E]dit trait / [R]estart");
}

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

        console.log(renderRecommendations(recommendations));

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
        const { recommendations, savedTraits, ideaDomain } =
          getIdeaRecommendations(engine);

        if (recommendations.length === 0) {
          console.log("\nNo matching workflows found for your profile.");
          confirmRl.close();
          db.close();
          return;
        }

        console.log(renderRecommendations(recommendations));

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
        const approveResponse = (await confirmAsk("> ")).trim().toLowerCase();

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

        const orchStore = new OrchestratorStore(db);
        const { LLMProvider } = await import("../llm/provider");
        const llm = new LLMProvider();

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
              const { GeneStore } = await import("../core/prompt/gene-store");
              const { PromptCompiler } = await import(
                "../core/prompt/prompt-compiler"
              );
              const geneStore = new GeneStore(db);
              const compiler = new PromptCompiler(geneStore);
              const { Planner } = await import("../core/orchestrator/planner");
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
              const bridge = new HermesAgentBridge();
              const dispatcher = new Dispatcher(orchStore, bridge);
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
              console.log(
                `  Task created but not dispatched (agent unavailable)`,
              );
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

        // Emit rejection events for unselected recommendations + penalize confidence
        const rejected = recommendations.filter(
          (_, i) => !selected.includes(i),
        );
        if (rejected.length > 0) {
          for (const rec of rejected) {
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
          for (const rec of rejected) {
            if (rec.traitTargets) {
              for (const dim of Object.keys(rec.traitTargets)) {
                rejectedDims.add(dim);
              }
            }
          }
          const { ProfileEngine } = await import("../core/profile/engine");
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
        }
      }

      confirmRl.close();
      db.close();
    });

  work
    .command("status")
    .description("Show current workspace status")
    .action(() => {
      const { db } = getEngine();
      const store = new WorkspaceStore(db);

      const workspaces = store.listWorkspaces();
      const active = workspaces.filter((w) => w.status === "active");

      if (active.length === 0) {
        console.log(
          "No active workspaces. Run `kai work start` to create one.",
        );
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
    });

  work
    .command("list")
    .description("List all workspaces")
    .action(() => {
      const { db } = getEngine();
      const store = new WorkspaceStore(db);

      const workspaces = store.listWorkspaces();

      console.log(renderWorkspaceList(workspaces));

      db.close();
    });
}
