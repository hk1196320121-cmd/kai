import type { Command } from "commander";
import { ProfileEngine } from "../core/profile/engine";
import { GeneStore } from "../core/prompt/gene-store";
import { PromptCompiler } from "../core/prompt/prompt-compiler";
import { PromptEvolver } from "../core/prompt/prompt-evolver";
import type { GeneType, PromptTask } from "../core/prompt/types";
import { KaiDB } from "../db/client";
import { LLMProvider } from "../llm/provider";
import { getDbPath } from "./utils";

const VALID_TASKS: PromptTask[] = ["planner", "derivator", "observer"];
const VALID_GENE_TYPES: GeneType[] = [
  "intent",
  "contract",
  "adapter",
  "example",
  "tone",
];

function validateTask(task: string): PromptTask {
  if (!VALID_TASKS.includes(task as PromptTask)) {
    console.error(
      `Invalid task: ${task}. Must be one of: ${VALID_TASKS.join(", ")}`,
    );
    process.exit(1);
  }
  return task as PromptTask;
}

function getStore(): { db: KaiDB; store: GeneStore } {
  const db = new KaiDB(getDbPath());
  const store = new GeneStore(db);
  return { db, store };
}

function formatGeneSummary(gene: {
  id: string;
  task: string;
  type: string;
  content: string;
  created_at: string;
}): string {
  const preview =
    gene.content.length > 60 ? `${gene.content.slice(0, 57)}...` : gene.content;
  return `${gene.id.slice(0, 8)}  ${gene.task.padEnd(10)} ${gene.type.padEnd(10)} ${preview}`;
}

function formatChampion(champion: {
  task: string;
  segment_id: string;
  variant_id: string;
  model: string;
  win_rate: number;
  battle_count: number;
  promoted_at: string;
  is_locked: number;
}): string {
  const lockIcon = champion.is_locked ? " [LOCKED]" : "";
  const winPct = (champion.win_rate * 100).toFixed(1);
  return [
    `  Task:       ${champion.task}`,
    `  Segment:    ${champion.segment_id}`,
    `  Variant:    ${champion.variant_id.slice(0, 8)}`,
    `  Model:      ${champion.model}`,
    `  Win Rate:   ${winPct}%`,
    `  Battles:    ${champion.battle_count}`,
    `  Promoted:   ${champion.promoted_at}`,
    `  Locked:     ${champion.is_locked ? "Yes" : "No"}${lockIcon}`,
  ].join("\n");
}

function formatTournament(t: {
  id: string;
  task: string;
  variant_a_id: string;
  variant_b_id: string;
  winner: string | null;
  judge_confidence: number | null;
  created_at: string;
}): string {
  const winner =
    t.winner === "a"
      ? `A (${t.variant_a_id.slice(0, 8)})`
      : t.winner === "b"
        ? `B (${t.variant_b_id.slice(0, 8)})`
        : t.winner === "tie"
          ? "Tie"
          : "Pending";
  const confidence = t.judge_confidence?.toFixed(2) ?? "N/A";
  return `${t.id.slice(0, 8)}  A:${t.variant_a_id.slice(0, 8)} vs B:${t.variant_b_id.slice(0, 8)}  Winner: ${winner.padEnd(20)} Conf: ${confidence}  ${t.created_at}`;
}

export function registerPromptCommands(program: Command): void {
  const prompt = program
    .command("prompt")
    .description("Manage prompt genomes, genes, champions, and evolution");

  // --- Gene subcommands ---

  const gene = prompt.command("gene").description("Manage prompt genes");

  gene
    .command("list")
    .description("List genes with optional filtering")
    .option("--task <task>", "Filter by task")
    .option("--type <type>", "Filter by gene type")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const { db, store } = getStore();
      try {
        let genes = store.listGenes(
          opts.task ? validateTask(opts.task) : undefined,
        );

        if (opts.type) {
          if (!VALID_GENE_TYPES.includes(opts.type as GeneType)) {
            console.error(
              `Invalid type: ${opts.type}. Must be one of: ${VALID_GENE_TYPES.join(", ")}`,
            );
            process.exit(1);
          }
          genes = genes.filter((g) => g.type === opts.type);
        }

        if (genes.length === 0) {
          console.log("No genes found.");
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(genes, null, 2));
          return;
        }

        console.log(`Genes (${genes.length}):\n`);
        console.log("ID        Task       Type       Content");
        for (const gene of genes) {
          console.log(formatGeneSummary(gene));
        }
      } finally {
        db.close();
      }
    });

  gene
    .command("inspect <gene-id>")
    .description("Show full gene details as JSON")
    .action((geneId: string) => {
      const { db, store } = getStore();
      try {
        const gene = store.getGene(geneId);
        if (!gene) {
          console.error(`Gene not found: ${geneId}`);
          process.exit(1);
        }
        console.log(JSON.stringify(gene, null, 2));
      } finally {
        db.close();
      }
    });

  // --- Genome subcommands ---

  const genome = prompt.command("genome").description("Manage prompt genomes");

  genome
    .command("compile")
    .description("Compile prompt for a task")
    .requiredOption("--task <task>", "Task to compile for")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const task = validateTask(opts.task);
      const { db, store } = getStore();
      try {
        const compiler = new PromptCompiler(store);
        const engine = new ProfileEngine(db);
        const traits = engine.getTraits();
        const compiled = await compiler.compile(task, traits);

        if (opts.json) {
          console.log(JSON.stringify(compiled, null, 2));
          return;
        }

        console.log(`\n=== Compiled Prompt (${task}) ===`);
        console.log(`Genome:  ${compiled.genome_id || "(fallback)"}`);
        console.log(`Segment: ${compiled.segment_id}`);
        console.log(`Variant: ${compiled.variant_id ?? "(none)"}`);
        console.log(`Genes:   ${compiled.gene_count}`);
        console.log(`Cached:  ${compiled.cached}`);
        console.log(`\n--- Prompt ---\n`);
        console.log(compiled.prompt);
      } finally {
        db.close();
      }
    });

  genome
    .command("show")
    .description("Show genome details as JSON")
    .requiredOption("--task <task>", "Task to show genome for")
    .action((opts) => {
      const task = validateTask(opts.task);
      const { db, store } = getStore();
      try {
        const genome = store.getGenomeByTask(task);
        if (!genome) {
          console.error(`No genome found for task: ${task}`);
          process.exit(1);
        }
        console.log(JSON.stringify(genome, null, 2));
      } finally {
        db.close();
      }
    });

  // --- Champion subcommands ---

  const champion = prompt
    .command("champion")
    .description("Manage prompt champions");

  champion
    .command("show")
    .description("Show champion info")
    .requiredOption("--task <task>", "Task to show champion for")
    .option("--segment <seg>", "Segment ID", "default")
    .option("--all-segments", "Show champions across all segments")
    .action((opts) => {
      const task = validateTask(opts.task);
      const { db, store } = getStore();
      try {
        if (opts.allSegments) {
          const segments = store.listSegments();
          const champions = segments
            .map((seg) => store.getChampion(task, seg.id))
            .filter((c) => c !== null);

          if (champions.length === 0) {
            console.log(`No champions found for task: ${task}`);
            return;
          }

          console.log(`\n=== Champions for ${task} ===\n`);
          for (const c of champions) {
            console.log(formatChampion(c));
            console.log();
          }
        } else {
          const champ = store.getChampion(task, opts.segment);
          if (!champ) {
            console.log(
              `No champion found for task: ${task}, segment: ${opts.segment}`,
            );
            return;
          }
          console.log(formatChampion(champ));
        }
      } finally {
        db.close();
      }
    });

  champion
    .command("lock")
    .description("Lock current champion")
    .requiredOption("--task <task>", "Task to lock champion for")
    .option("--segment <seg>", "Segment ID", "default")
    .action((opts) => {
      const task = validateTask(opts.task);
      const { db, store } = getStore();
      try {
        const champ = store.getChampion(task, opts.segment);
        if (!champ) {
          console.error(
            `No champion found for task: ${task}, segment: ${opts.segment}`,
          );
          process.exit(1);
        }
        store.lockChampion(task, opts.segment);
        console.log(
          `Champion locked for ${task}/${opts.segment} (variant: ${champ.variant_id.slice(0, 8)})`,
        );
      } finally {
        db.close();
      }
    });

  champion
    .command("rollback")
    .description("Rollback to previous champion")
    .requiredOption("--task <task>", "Task to rollback champion for")
    .option("--segment <seg>", "Segment ID", "default")
    .action((opts) => {
      const task = validateTask(opts.task);
      const { db, store } = getStore();
      try {
        const result = store.rollbackChampion(task, opts.segment);
        if (!result) {
          console.error(
            `Cannot rollback: no previous champion for task: ${task}, segment: ${opts.segment}`,
          );
          process.exit(1);
        }
        console.log(`Rolled back champion for ${task}/${opts.segment}`);
        console.log(`New variant: ${result.variant_id.slice(0, 8)}`);
        console.log(`Win rate: ${(result.win_rate * 100).toFixed(1)}%`);
      } finally {
        db.close();
      }
    });

  // --- Evolve ---

  prompt
    .command("evolve")
    .description("Run evolution with tournaments")
    .requiredOption("--task <task>", "Task to evolve")
    .option("--rounds <n>", "Number of evolution rounds", "1")
    .option("--segment <seg>", "Segment ID", "default")
    .option("--model <model>", "LLM model to use", "gpt-4o-mini")
    .option("--auto", "Auto-approve champion promotion")
    .action(async (opts) => {
      const task = validateTask(opts.task);
      const rounds = Number.parseInt(opts.rounds, 10);
      if (Number.isNaN(rounds) || rounds < 1) {
        console.error("Invalid --rounds value. Must be a positive integer.");
        process.exit(1);
      }

      const { db, store } = getStore();
      try {
        const llm = new LLMProvider();
        const evolver = new PromptEvolver(store, llm);

        console.log(
          `Evolving ${task} (segment: ${opts.segment}, model: ${opts.model}, rounds: ${rounds})...`,
        );

        let lastResult = null;
        for (let i = 0; i < rounds; i++) {
          if (i > 0) console.log(`\n--- Round ${i + 1} ---`);
          const result = await evolver.evolve({
            task,
            segment_id: opts.segment,
            model: opts.model,
            rounds: 1,
            auto_approve: opts.auto || false,
          });
          lastResult = result;

          console.log(`  Battles run: ${result.battles_run}`);
          console.log(`  Champion promoted: ${result.champion_promoted}`);
          if (result.champion_promoted && result.champion_variant_id) {
            console.log(
              `  New champion: ${result.champion_variant_id.slice(0, 8)}`,
            );
            if (result.previous_champion_variant_id) {
              console.log(
                `  Previous:     ${result.previous_champion_variant_id.slice(0, 8)}`,
              );
            }
          }
        }

        if (lastResult) {
          console.log("\nEvolution complete.");
        }
      } catch (err) {
        console.error(`Evolution failed: ${(err as Error).message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });

  // --- Tournament subcommands ---

  const tournament = prompt
    .command("tournament")
    .description("View tournament history");

  tournament
    .command("results")
    .description("Show tournament history")
    .requiredOption("--task <task>", "Task to show tournaments for")
    .option("--last <n>", "Number of recent tournaments to show", "10")
    .action((opts) => {
      const task = validateTask(opts.task);
      const limit = Number.parseInt(opts.last, 10);
      if (Number.isNaN(limit) || limit < 1) {
        console.error("Invalid --last value. Must be a positive integer.");
        process.exit(1);
      }

      const { db, store } = getStore();
      try {
        const tournaments = store.listTournamentsByTask(task, limit);

        if (tournaments.length === 0) {
          console.log(`No tournaments found for task: ${task}`);
          return;
        }

        console.log(
          `\nTournaments for ${task} (last ${tournaments.length}):\n`,
        );
        console.log(
          "ID        Match                              Winner                Conf        Date",
        );
        for (const t of tournaments) {
          console.log(formatTournament(t));
        }
      } finally {
        db.close();
      }
    });
}
