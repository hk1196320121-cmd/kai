import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { KaiDB } from "../../db/client";
import type {
  EvalSource,
  GeneType,
  MutationType,
  PromptChampion,
  PromptChampionHistory,
  PromptEvalCase,
  PromptGene,
  PromptGenome,
  PromptSegment,
  PromptTask,
  PromptTournament,
  PromptVariant,
  TournamentWinner,
} from "./types";

export class GeneStore {
  private db: Database;

  constructor(kaiDb: KaiDB) {
    this.db = kaiDb.getDatabase();
  }

  // --- Genes ---

  createGene(input: {
    task: PromptTask;
    type: GeneType;
    content: string;
    trait_bindings?: string;
    metadata?: string;
  }): PromptGene {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO prompt_genes (id, task, type, content, trait_bindings, metadata) VALUES ($id, $task, $type, $content, $bindings, $meta)`,
      )
      .run({
        $id: id,
        $task: input.task,
        $type: input.type,
        $content: input.content,
        $bindings: input.trait_bindings ?? "{}",
        $meta: input.metadata ?? "{}",
      });
    return this.getGene(id) as PromptGene;
  }

  getGene(id: string): PromptGene | null {
    return this.db
      .query("SELECT * FROM prompt_genes WHERE id = $id")
      .get({ $id: id }) as PromptGene | null;
  }

  listGenes(task?: PromptTask): PromptGene[] {
    if (task) {
      return this.db
        .query(
          "SELECT * FROM prompt_genes WHERE task = $task ORDER BY created_at",
        )
        .all({ $task: task }) as PromptGene[];
    }
    return this.db
      .query("SELECT * FROM prompt_genes ORDER BY created_at")
      .all() as PromptGene[];
  }

  updateGene(
    id: string,
    fields: Partial<
      Pick<PromptGene, "content" | "trait_bindings" | "metadata">
    >,
  ): void {
    const sets: string[] = [];
    const params: Record<string, string> = { $id: id };
    if (fields.content !== undefined) {
      sets.push("content = $content");
      params.$content = fields.content;
    }
    if (fields.trait_bindings !== undefined) {
      sets.push("trait_bindings = $bindings");
      params.$bindings = fields.trait_bindings;
    }
    if (fields.metadata !== undefined) {
      sets.push("metadata = $meta");
      params.$meta = fields.metadata;
    }
    if (sets.length === 0) return;
    this.db
      .query(`UPDATE prompt_genes SET ${sets.join(", ")} WHERE id = $id`)
      .run(params);
  }

  deleteGene(id: string): void {
    this.db.query("DELETE FROM prompt_genes WHERE id = $id").run({ $id: id });
  }

  // --- Genomes ---

  createGenome(input: {
    task: PromptTask;
    gene_ids: string[];
    compiler_config?: string;
  }): PromptGenome {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO prompt_genomes (id, task, gene_ids, compiler_config) VALUES ($id, $task, $geneIds, $config)`,
      )
      .run({
        $id: id,
        $task: input.task,
        $geneIds: JSON.stringify(input.gene_ids),
        $config: input.compiler_config ?? "{}",
      });
    return this.getGenome(id) as PromptGenome;
  }

  getGenome(id: string): PromptGenome | null {
    return this.db
      .query("SELECT * FROM prompt_genomes WHERE id = $id")
      .get({ $id: id }) as PromptGenome | null;
  }

  getGenomeByTask(task: PromptTask): PromptGenome | null {
    return this.db
      .query("SELECT * FROM prompt_genomes WHERE task = $task LIMIT 1")
      .get({ $task: task }) as PromptGenome | null;
  }

  // --- Variants ---

  createVariant(input: {
    genome_id: string;
    compiled_prompt: string;
    generation: number;
    parent_variant_id?: string | null;
    mutation_type?: MutationType | null;
  }): PromptVariant {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO prompt_variants (id, genome_id, compiled_prompt, generation, parent_variant_id, mutation_type) VALUES ($id, $genome, $prompt, $gen, $parent, $mut)`,
      )
      .run({
        $id: id,
        $genome: input.genome_id,
        $prompt: input.compiled_prompt,
        $gen: input.generation,
        $parent: input.parent_variant_id ?? null,
        $mut: input.mutation_type ?? null,
      });
    return this.getVariant(id) as PromptVariant;
  }

  getVariant(id: string): PromptVariant | null {
    return this.db
      .query("SELECT * FROM prompt_variants WHERE id = $id")
      .get({ $id: id }) as PromptVariant | null;
  }

  listVariantsByGenome(genomeId: string): PromptVariant[] {
    return this.db
      .query(
        "SELECT * FROM prompt_variants WHERE genome_id = $genome ORDER BY created_at",
      )
      .all({ $genome: genomeId }) as PromptVariant[];
  }

  // --- Segments ---

  getSegment(id: string): PromptSegment | null {
    return this.db
      .query("SELECT * FROM prompt_segments WHERE id = $id")
      .get({ $id: id }) as PromptSegment | null;
  }

  listSegments(): PromptSegment[] {
    return this.db
      .query("SELECT * FROM prompt_segments ORDER BY name")
      .all() as PromptSegment[];
  }

  // --- Eval Cases ---

  createEvalCase(input: {
    task: PromptTask;
    input: string;
    expected_output?: string;
    difficulty?: string;
    source?: EvalSource;
  }): PromptEvalCase {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO prompt_eval_cases (id, task, input, expected_output, difficulty, source) VALUES ($id, $task, $input, $expected, $difficulty, $source)`,
      )
      .run({
        $id: id,
        $task: input.task,
        $input: input.input,
        $expected: input.expected_output ?? null,
        $difficulty: input.difficulty ?? "medium",
        $source: input.source ?? "synthetic",
      });
    return this.db
      .query("SELECT * FROM prompt_eval_cases WHERE id = $id")
      .get({ $id: id }) as PromptEvalCase;
  }

  listEvalCasesByTask(task: PromptTask): PromptEvalCase[] {
    return this.db
      .query(
        "SELECT * FROM prompt_eval_cases WHERE task = $task ORDER BY created_at",
      )
      .all({ $task: task }) as PromptEvalCase[];
  }

  countEvalCasesByTask(task: PromptTask): number {
    const row = this.db
      .query("SELECT COUNT(*) as c FROM prompt_eval_cases WHERE task = $task")
      .get({ $task: task }) as { c: number };
    return row.c;
  }

  // --- Tournaments ---

  createTournament(input: {
    task: PromptTask;
    variant_a_id: string;
    variant_b_id: string;
    eval_case_id: string;
    segment_id: string;
    model: string;
  }): PromptTournament {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO prompt_tournaments (id, task, variant_a_id, variant_b_id, eval_case_id, segment_id, model) VALUES ($id, $task, $a, $b, $ec, $seg, $model)`,
      )
      .run({
        $id: id,
        $task: input.task,
        $a: input.variant_a_id,
        $b: input.variant_b_id,
        $ec: input.eval_case_id,
        $seg: input.segment_id,
        $model: input.model,
      });
    return this.db
      .query("SELECT * FROM prompt_tournaments WHERE id = $id")
      .get({ $id: id }) as PromptTournament;
  }

  updateTournamentResult(
    id: string,
    winner: TournamentWinner,
    reasoning: string,
    confidence: number,
  ): void {
    this.db
      .query(
        `UPDATE prompt_tournaments SET winner = $winner, judge_reasoning = $reasoning, judge_confidence = $confidence, judged_at = datetime('now') WHERE id = $id`,
      )
      .run({
        $id: id,
        $winner: winner,
        $reasoning: reasoning,
        $confidence: confidence,
      });
  }

  listTournamentsByTask(task: PromptTask, limit?: number): PromptTournament[] {
    let sql =
      "SELECT * FROM prompt_tournaments WHERE task = $task ORDER BY created_at DESC";
    const params: Record<string, string | number> = { $task: task };
    if (limit !== undefined) {
      sql += " LIMIT $limit";
      params.$limit = limit;
    }
    return this.db.query(sql).all(params) as PromptTournament[];
  }

  countTournamentWins(
    variantId: string,
    task: string,
    segmentId: string,
  ): { wins: number; losses: number; ties: number; total: number } {
    const winAsA = this.db
      .query(
        `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND variant_a_id = $vid AND winner = 'a'`,
      )
      .get({ $task: task, $seg: segmentId, $vid: variantId }) as {
      c: number;
    };
    const winAsB = this.db
      .query(
        `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND variant_b_id = $vid AND winner = 'b'`,
      )
      .get({ $task: task, $seg: segmentId, $vid: variantId }) as {
      c: number;
    };
    const lossAsA = this.db
      .query(
        `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND variant_a_id = $vid AND winner = 'b'`,
      )
      .get({ $task: task, $seg: segmentId, $vid: variantId }) as {
      c: number;
    };
    const lossAsB = this.db
      .query(
        `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND variant_b_id = $vid AND winner = 'a'`,
      )
      .get({ $task: task, $seg: segmentId, $vid: variantId }) as {
      c: number;
    };
    const tieRows = this.db
      .query(
        `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND (variant_a_id = $vid OR variant_b_id = $vid) AND winner = 'tie'`,
      )
      .get({ $task: task, $seg: segmentId, $vid: variantId }) as {
      c: number;
    };

    const wins = winAsA.c + winAsB.c;
    const losses = lossAsA.c + lossAsB.c;
    const ties = tieRows.c;
    const total = wins + losses + ties;
    return { wins, losses, ties, total };
  }

  // --- Champions ---

  getChampion(
    task: PromptTask,
    segmentId: string,
    model?: string,
  ): PromptChampion | null {
    const m = model ?? "gpt-4o-mini";
    return this.db
      .query(
        "SELECT * FROM prompt_champions WHERE task = $task AND segment_id = $seg AND model = $model",
      )
      .get({
        $task: task,
        $seg: segmentId,
        $model: m,
      }) as PromptChampion | null;
  }

  setChampion(input: {
    task: PromptTask;
    segment_id: string;
    variant_id: string;
    model: string;
    win_rate: number;
    battle_count: number;
    previous_variant_id: string | null;
  }): boolean {
    const current = this.getChampion(input.task, input.segment_id, input.model);
    if (current?.is_locked) {
      return false;
    }
    const id = randomUUID();
    if (current) {
      this.db
        .query(
          `INSERT INTO prompt_champion_history (id, task, segment_id, variant_id, model, win_rate, battle_count, promoted_at, demoted_at, demotion_reason) VALUES ($id, $task, $seg, $vid, $model, $wr, $bc, $promoted, datetime('now'), 'superseded')`,
        )
        .run({
          $id: randomUUID(),
          $task: input.task,
          $seg: input.segment_id,
          $vid: current.variant_id,
          $model: input.model,
          $wr: current.win_rate,
          $bc: current.battle_count,
          $promoted: current.promoted_at,
        });
    }
    this.db
      .query(
        `INSERT OR REPLACE INTO prompt_champions (id, task, segment_id, variant_id, model, win_rate, battle_count, promoted_at, previous_variant_id, is_locked) VALUES ($id, $task, $seg, $vid, $model, $wr, $bc, datetime('now'), $prev, 0)`,
      )
      .run({
        $id: id,
        $task: input.task,
        $seg: input.segment_id,
        $vid: input.variant_id,
        $model: input.model,
        $wr: input.win_rate,
        $bc: input.battle_count,
        $prev: input.previous_variant_id ?? current?.variant_id ?? null,
      });
    return true;
  }

  lockChampion(task: PromptTask, segmentId: string, model?: string): void {
    const m = model ?? "gpt-4o-mini";
    this.db
      .query(
        "UPDATE prompt_champions SET is_locked = 1 WHERE task = $task AND segment_id = $seg AND model = $model",
      )
      .run({ $task: task, $seg: segmentId, $model: m });
  }

  unlockChampion(task: PromptTask, segmentId: string, model?: string): void {
    const m = model ?? "gpt-4o-mini";
    this.db
      .query(
        "UPDATE prompt_champions SET is_locked = 0 WHERE task = $task AND segment_id = $seg AND model = $model",
      )
      .run({ $task: task, $seg: segmentId, $model: m });
  }

  getChampionHistory(
    task: PromptTask,
    segmentId: string,
    model?: string,
  ): PromptChampionHistory[] {
    const m = model ?? "gpt-4o-mini";
    return this.db
      .query(
        "SELECT * FROM prompt_champion_history WHERE task = $task AND segment_id = $seg AND model = $model ORDER BY promoted_at DESC",
      )
      .all({
        $task: task,
        $seg: segmentId,
        $model: m,
      }) as PromptChampionHistory[];
  }

  rollbackChampion(
    task: PromptTask,
    segmentId: string,
    model?: string,
  ): PromptChampion | null {
    const m = model ?? "gpt-4o-mini";
    const current = this.getChampion(task, segmentId, m);
    if (!current?.previous_variant_id) return null;

    const history = this.getChampionHistory(task, segmentId, m);
    const prevEntry = history.find(
      (h) => h.variant_id === current.previous_variant_id,
    );
    if (!prevEntry) return null;

    this.setChampion({
      task,
      segment_id: segmentId,
      variant_id: prevEntry.variant_id,
      model: m,
      win_rate: prevEntry.win_rate,
      battle_count: prevEntry.battle_count,
      previous_variant_id: null,
    });

    this.db
      .query(
        `UPDATE prompt_champion_history SET demotion_reason = 'rollback' WHERE task = $task AND segment_id = $seg AND variant_id = $vid AND demotion_reason = 'superseded'`,
      )
      .run({
        $task: task,
        $seg: segmentId,
        $vid: current.variant_id,
      });

    return this.getChampion(task, segmentId, m);
  }
}
