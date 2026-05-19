import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Command } from "commander";
import { Derivator } from "../core/profile/derivator";
import type { AddObservationInput } from "../core/profile/engine";
import { WorkspaceStore } from "../workspace/store";
import { getEngine } from "./utils";

// --- Git History Scanner ---

// Git scan thresholds
const MIN_GIT_COMMITS = 5;
const MORNING_HOUR_START = 5;
const MORNING_HOUR_END = 8;
const MORNING_RATIO_THRESHOLD = 0.3;
const DETAIL_LEVEL_HIGH_CHARS = 50;
const DETAIL_LEVEL_MED_CHARS = 20;

// Signal extraction thresholds
const WORD_COUNT_DETAIL_HIGH = 30;
const WORD_COUNT_DETAIL_MED = 10;
const WORD_COUNT_VERBOSE = 40;
const WORD_COUNT_MODERATE = 15;

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
  } catch {
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
  } catch {
    // detached HEAD — skip
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

// --- Cold Start Signal Extraction ---

interface ColdStartAnswer {
  slug: string;
  text: string;
}

export function extractColdStartSignals(
  answers: ColdStartAnswer[],
  gitHints: { dimension: string; hints: string[] }[],
  workspaceId: string,
): AddObservationInput[] {
  const observations: AddObservationInput[] = [];

  // Collect word counts and specifics across all answers for aggregate signals
  const wordCounts: number[] = [];
  let anySpecifics = false;

  for (const { slug, text } of answers) {
    observations.push({
      type: "signal",
      key: `coldstart:${slug}`,
      value: JSON.stringify({ answer: text, workspace_id: workspaceId }),
      confidence: 8,
      source: "coldstart",
      provenance: makeProvenance(),
    });

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    wordCounts.push(wordCount);
    if (/\d+|specific|exactly|precisely/.test(text)) anySpecifics = true;
  }

  // Emit one aggregate detail_level signal (not per-answer)
  if (wordCounts.length === 0) return observations;
  const avgWordCount =
    wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
  observations.push({
    type: "signal",
    key: "coldstart:signal.detail_level",
    value: JSON.stringify({
      level:
        avgWordCount > WORD_COUNT_DETAIL_HIGH
          ? "high"
          : avgWordCount > WORD_COUNT_DETAIL_MED
            ? "medium"
            : "low",
      word_count: Math.round(avgWordCount),
      has_specifics: anySpecifics,
    }),
    confidence: 7,
    source: "coldstart",
    provenance: makeProvenance("detail_level"),
  });

  // Emit one aggregate comm_style signal (not per-answer)
  observations.push({
    type: "signal",
    key: "coldstart:signal.comm_style",
    value: JSON.stringify({
      style:
        avgWordCount > WORD_COUNT_VERBOSE
          ? "verbose"
          : avgWordCount > WORD_COUNT_MODERATE
            ? "moderate"
            : "terse",
      word_count: Math.round(avgWordCount),
    }),
    confidence: 6,
    source: "coldstart",
    provenance: makeProvenance("comm_style"),
  });

  const allText = answers
    .map((a) => a.text)
    .join(" ")
    .toLowerCase();
  const domainSignals: string[] = [];
  if (/code|debug|deploy|api|git|build|test/i.test(allText))
    domainSignals.push("engineering");
  if (/design|ux|ui|wireframe|prototype/i.test(allText))
    domainSignals.push("design");
  if (/manage|team|sprint|roadmap|stakeholder/i.test(allText))
    domainSignals.push("management");
  if (/research|paper|study|analysis|data/i.test(allText))
    domainSignals.push("research");
  if (/write|document|content|blog|report/i.test(allText))
    domainSignals.push("writing");

  if (domainSignals.length > 0) {
    if (gitHints.some((h) => h.dimension === "detail_oriented")) {
      domainSignals.push("engineering");
    }

    observations.push({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: [...new Set(domainSignals)] }),
      confidence: 7,
      source: "coldstart",
      provenance: makeProvenance("domain"),
    });
  }

  return observations;
}

// --- Profile Preview Display ---

function formatTraitBar(value: number, confidence: number): string {
  const filled = Math.round(value * 10);
  const empty = 10 - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `${bar}  ${confidence}/10`;
}

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
    const bar = formatTraitBar(t.value, t.confidence);
    const hints = hintMap.get(t.dimension);
    const hintStr = hints ? ` + ${hints.join(", ")}` : "";
    const reasoning =
      t.reasoning.length > 60 ? `${t.reasoning.slice(0, 57)}...` : t.reasoning;
    console.log(`  ${t.dimension.padEnd(22)}${bar}  — ${reasoning}${hintStr}`);
  }

  console.log("\nLooks right? [Y]es / [E]dit trait / [R]estart");
}

// --- CLI Commands ---

const QUESTIONS = [
  { slug: "goal", prompt: "What are you trying to get done?\n> " },
  { slug: "success", prompt: "What would a good result look like?\n> " },
  {
    slug: "constraints",
    prompt: "Any constraints — people, tools, deadlines?\n> ",
  },
  {
    slug: "format",
    prompt:
      "How should Kai organize this?\n  ▸ Checklist    ▸ Brief    ▸ Plan    ▸ Decision log\n> ",
  },
];

export function registerWorkCommands(program: Command): void {
  const work = program.command("work").description("Workspace management");

  work
    .command("start")
    .description("Start a new workspace with cold start profile bootstrapping")
    .action(async () => {
      const { db, engine } = getEngine();

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

      // Step 1: Git scan
      console.log("Scanning your git history...");
      const gitResult = scanGitHistory(process.cwd());
      if (gitResult.observations.length > 0) {
        console.log(
          `  Found ${gitResult.observations.length} signals from git history`,
        );
      } else {
        console.log("  No git history to scan (that's OK)");
      }

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

      // Step 3: 4-question flow
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const ask = (q: string): Promise<string> =>
        new Promise((r) => rl.question(q, r));

      console.log(`\nWorkspace: ${workspace.id}\n`);

      const answers: ColdStartAnswer[] = [];
      for (const q of QUESTIONS) {
        let answer = (await ask(q.prompt)).trim();

        if (!answer && q.slug === "goal") {
          console.log("This one's required — tell me what you're working on.");
          answer = (await ask(q.prompt)).trim();
          if (!answer) {
            console.log("Goal is required. Cleaning up and aborting.");
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

      // Step 4: Signal extraction
      const signals = extractColdStartSignals(
        answers,
        gitResult.traits,
        workspace.id,
      );
      for (const obs of signals) {
        engine.addObservation(obs);
      }

      // Step 5: Derive traits in-memory (preview mode)
      const derivator = new Derivator(engine);
      const previewTraits = derivator.deriveFromRules(false);

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

        for (const ws of active) {
          const stats = taskStats.get(ws.id) ?? { total: 0, completed: 0 };
          const eventCount = eventCounts.get(ws.id) ?? 0;
          console.log(`\n=== ${ws.name} (${ws.id}) ===`);
          console.log(`  Status: ${ws.status}`);
          console.log(`  Tasks: ${stats.total} (${stats.completed} completed)`);
          console.log(`  Events: ${eventCount}`);
          console.log(`  Created: ${ws.created_at}`);
        }
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

      if (workspaces.length === 0) {
        console.log("No workspaces found. Run `kai work start` to create one.");
      } else {
        const ids = workspaces.map((w) => w.id);
        const taskStats = store.getTaskStatsByWorkspaces(ids);

        console.log(`\nWorkspaces (${workspaces.length}):\n`);
        for (const ws of workspaces) {
          const stats = taskStats.get(ws.id) ?? { total: 0, completed: 0 };
          console.log(
            `  ${ws.status === "active" ? "●" : "○"} ${ws.name} (${ws.id.slice(0, 8)})`,
          );
          console.log(
            `    Status: ${ws.status} | Tasks: ${stats.completed}/${stats.total} | Created: ${ws.created_at.slice(0, 10)}`,
          );
        }
      }

      db.close();
    });
}
