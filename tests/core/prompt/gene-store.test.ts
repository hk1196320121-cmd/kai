import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type {
  PromptGene,
  PromptGenome,
  PromptVariant,
  PromptSegment,
  PromptEvalCase,
  PromptTournament,
  PromptChampion,
  PromptChampionHistory,
} from "../../../src/core/prompt/types";

describe("GeneStore", () => {
  let db: KaiDB;
  let store: GeneStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("gene-store");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  // --- Genes ---
  describe("Gene CRUD", () => {
    test("createGene inserts and returns gene", () => {
      const gene = store.createGene({
        task: "planner",
        type: "intent",
        content: "You are a planner.",
      });
      expect(gene.id).toBeDefined();
      expect(gene.task).toBe("planner");
      expect(gene.type).toBe("intent");
      expect(gene.content).toBe("You are a planner.");
      expect(gene.trait_bindings).toBe("{}");
      expect(gene.metadata).toBe("{}");
    });

    test("createGene with optional fields", () => {
      const gene = store.createGene({
        task: "derivator",
        type: "tone",
        content: "Be concise.",
        trait_bindings: '{"verbosity": 0.3}',
        metadata: '{"version": 2}',
      });
      expect(gene.trait_bindings).toBe('{"verbosity": 0.3}');
      expect(gene.metadata).toBe('{"version": 2}');
    });

    test("getGene returns null for nonexistent id", () => {
      expect(store.getGene("nonexistent")).toBeNull();
    });

    test("getGene returns created gene", () => {
      const created = store.createGene({
        task: "observer",
        type: "adapter",
        content: "Observe behavior.",
      });
      const fetched = store.getGene(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.content).toBe("Observe behavior.");
    });

    test("listGenes returns all genes", () => {
      store.createGene({ task: "planner", type: "intent", content: "A" });
      store.createGene({ task: "derivator", type: "contract", content: "B" });
      const genes = store.listGenes();
      // Includes seed genes from migration (planner-intent-v1, planner-contract-v1)
      expect(genes.length).toBeGreaterThanOrEqual(4);
    });

    test("listGenes filters by task", () => {
      store.createGene({ task: "planner", type: "intent", content: "A" });
      store.createGene({ task: "derivator", type: "contract", content: "B" });
      const plannerGenes = store.listGenes("planner");
      // Includes seed genes from migration (planner-intent-v1, planner-contract-v1)
      expect(plannerGenes.length).toBeGreaterThanOrEqual(3);
      for (const g of plannerGenes) {
        expect(g.task).toBe("planner");
      }
    });

    test("updateGene updates content", () => {
      const gene = store.createGene({ task: "planner", type: "intent", content: "Original" });
      store.updateGene(gene.id, { content: "Updated" });
      const updated = store.getGene(gene.id);
      expect(updated!.content).toBe("Updated");
    });

    test("updateGene updates trait_bindings and metadata", () => {
      const gene = store.createGene({ task: "planner", type: "intent", content: "Test" });
      store.updateGene(gene.id, {
        trait_bindings: '{"key": "val"}',
        metadata: '{"updated": true}',
      });
      const updated = store.getGene(gene.id);
      expect(updated!.trait_bindings).toBe('{"key": "val"}');
      expect(updated!.metadata).toBe('{"updated": true}');
    });

    test("updateGene with no fields is a no-op", () => {
      const gene = store.createGene({ task: "planner", type: "intent", content: "Original" });
      store.updateGene(gene.id, {});
      const fetched = store.getGene(gene.id);
      expect(fetched!.content).toBe("Original");
    });

    test("deleteGene removes the gene", () => {
      const gene = store.createGene({ task: "planner", type: "intent", content: "Delete me" });
      store.deleteGene(gene.id);
      expect(store.getGene(gene.id)).toBeNull();
    });

    test("deleteGene on nonexistent id does not error", () => {
      expect(() => store.deleteGene("nonexistent")).not.toThrow();
    });
  });

  // --- Genomes ---
  describe("Genome CRUD", () => {
    test("createGenome inserts and returns genome", () => {
      const genome = store.createGenome({
        task: "planner",
        gene_ids: ["gene-1", "gene-2"],
      });
      expect(genome.id).toBeDefined();
      expect(genome.task).toBe("planner");
      expect(genome.gene_ids).toBe('["gene-1","gene-2"]');
      expect(genome.compiler_config).toBe("{}");
    });

    test("createGenome with compiler_config", () => {
      const genome = store.createGenome({
        task: "derivator",
        gene_ids: ["g1"],
        compiler_config: '{"separator": "\\n\\n"}',
      });
      expect(genome.compiler_config).toBe('{"separator": "\\n\\n"}');
    });

    test("getGenome returns null for nonexistent id", () => {
      expect(store.getGenome("nonexistent")).toBeNull();
    });

    test("getGenome returns created genome", () => {
      const created = store.createGenome({ task: "observer", gene_ids: ["g1"] });
      const fetched = store.getGenome(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });

    test("getGenomeByTask returns first genome for task", () => {
      // Seed data includes genome-planner-default for planner
      const genome = store.getGenomeByTask("planner");
      expect(genome).not.toBeNull();
      expect(genome!.task).toBe("planner");
    });

    test("getGenomeByTask returns null when no genome exists for task", () => {
      // observer has no seed genome
      expect(store.getGenomeByTask("observer")).toBeNull();
    });
  });

  // --- Variants ---
  describe("Variant CRUD", () => {
    let genome: PromptGenome;

    beforeEach(() => {
      genome = store.createGenome({ task: "planner", gene_ids: ["g1"] });
    });

    test("createVariant inserts and returns variant", () => {
      const variant = store.createVariant({
        genome_id: genome.id,
        compiled_prompt: "You are a planner.",
        generation: 1,
      });
      expect(variant.id).toBeDefined();
      expect(variant.genome_id).toBe(genome.id);
      expect(variant.compiled_prompt).toBe("You are a planner.");
      expect(variant.generation).toBe(1);
      expect(variant.parent_variant_id).toBeNull();
      expect(variant.mutation_type).toBeNull();
    });

    test("createVariant with parent and mutation_type", () => {
      const parent = store.createVariant({
        genome_id: genome.id,
        compiled_prompt: "Original",
        generation: 1,
      });
      const child = store.createVariant({
        genome_id: genome.id,
        compiled_prompt: "Mutated",
        generation: 2,
        parent_variant_id: parent.id,
        mutation_type: "intent_rephrase",
      });
      expect(child.parent_variant_id).toBe(parent.id);
      expect(child.mutation_type).toBe("intent_rephrase");
      expect(child.generation).toBe(2);
    });

    test("getVariant returns null for nonexistent id", () => {
      expect(store.getVariant("nonexistent")).toBeNull();
    });

    test("getVariant returns created variant", () => {
      const variant = store.createVariant({
        genome_id: genome.id,
        compiled_prompt: "Test",
        generation: 1,
      });
      const fetched = store.getVariant(variant.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.compiled_prompt).toBe("Test");
    });

    test("listVariantsByGenome returns variants for a genome", () => {
      store.createVariant({ genome_id: genome.id, compiled_prompt: "A", generation: 1 });
      store.createVariant({ genome_id: genome.id, compiled_prompt: "B", generation: 2 });
      const variants = store.listVariantsByGenome(genome.id);
      expect(variants).toHaveLength(2);
    });

    test("listVariantsByGenome returns empty for genome with no variants", () => {
      const empty = store.listVariantsByGenome("nonexistent");
      expect(empty).toHaveLength(0);
    });
  });

  // --- Segments ---
  describe("Segments", () => {
    test("listSegments includes default segment from seed data", () => {
      const segments = store.listSegments();
      expect(segments.length).toBeGreaterThanOrEqual(1);
      const defaultSeg = segments.find((s) => s.id === "default");
      expect(defaultSeg).toBeDefined();
      expect(defaultSeg!.name).toBe("default");
    });

    test("getSegment returns a segment by id", () => {
      const seg = store.getSegment("default");
      expect(seg).not.toBeNull();
      expect(seg!.name).toBe("default");
    });

    test("getSegment returns null for nonexistent id", () => {
      expect(store.getSegment("nonexistent")).toBeNull();
    });
  });

  // --- Eval Cases ---
  describe("EvalCase CRUD", () => {
    test("createEvalCase inserts and returns eval case", () => {
      const ec = store.createEvalCase({
        task: "planner",
        input: "Decompose: Build a CLI tool",
      });
      expect(ec.id).toBeDefined();
      expect(ec.task).toBe("planner");
      expect(ec.input).toBe("Decompose: Build a CLI tool");
      expect(ec.expected_output).toBeNull();
      expect(ec.difficulty).toBe("medium");
      expect(ec.source).toBe("synthetic");
    });

    test("createEvalCase with all optional fields", () => {
      const ec = store.createEvalCase({
        task: "derivator",
        input: "Derive behavior",
        expected_output: '{"result": "ok"}',
        difficulty: "hard",
        source: "real",
      });
      expect(ec.expected_output).toBe('{"result": "ok"}');
      expect(ec.difficulty).toBe("hard");
      expect(ec.source).toBe("real");
    });

    test("listEvalCasesByTask filters by task", () => {
      store.createEvalCase({ task: "planner", input: "A" });
      store.createEvalCase({ task: "derivator", input: "B" });
      store.createEvalCase({ task: "planner", input: "C" });
      const plannerCases = store.listEvalCasesByTask("planner");
      expect(plannerCases).toHaveLength(2);
      for (const c of plannerCases) {
        expect(c.task).toBe("planner");
      }
    });

    test("countEvalCasesByTask returns correct count", () => {
      expect(store.countEvalCasesByTask("planner")).toBe(0);
      store.createEvalCase({ task: "planner", input: "A" });
      store.createEvalCase({ task: "planner", input: "B" });
      expect(store.countEvalCasesByTask("planner")).toBe(2);
    });

    test("countEvalCasesByTask does not count other tasks", () => {
      store.createEvalCase({ task: "planner", input: "A" });
      store.createEvalCase({ task: "derivator", input: "B" });
      expect(store.countEvalCasesByTask("planner")).toBe(1);
      expect(store.countEvalCasesByTask("derivator")).toBe(1);
      expect(store.countEvalCasesByTask("observer")).toBe(0);
    });
  });

  // --- Tournaments ---
  describe("Tournament CRUD", () => {
    let variantA: PromptVariant;
    let variantB: PromptVariant;
    let evalCase: PromptEvalCase;

    beforeEach(() => {
      const genome = store.createGenome({ task: "planner", gene_ids: ["g1"] });
      variantA = store.createVariant({ genome_id: genome.id, compiled_prompt: "Prompt A", generation: 1 });
      variantB = store.createVariant({ genome_id: genome.id, compiled_prompt: "Prompt B", generation: 1 });
      evalCase = store.createEvalCase({ task: "planner", input: "Test input" });
    });

    test("createTournament inserts and returns tournament", () => {
      const t = store.createTournament({
        task: "planner",
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        eval_case_id: evalCase.id,
        segment_id: "default",
        model: "gpt-4o-mini",
      });
      expect(t.id).toBeDefined();
      expect(t.task).toBe("planner");
      expect(t.variant_a_id).toBe(variantA.id);
      expect(t.variant_b_id).toBe(variantB.id);
      expect(t.eval_case_id).toBe(evalCase.id);
      expect(t.segment_id).toBe("default");
      expect(t.model).toBe("gpt-4o-mini");
      expect(t.winner).toBeNull();
      expect(t.judge_reasoning).toBeNull();
      expect(t.judge_confidence).toBeNull();
    });

    test("updateTournamentResult sets winner, reasoning, confidence", () => {
      const t = store.createTournament({
        task: "planner",
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        eval_case_id: evalCase.id,
        segment_id: "default",
        model: "gpt-4o-mini",
      });
      store.updateTournamentResult(t.id, "a", "Variant A was more concise", 0.85);
      // Re-fetch to verify persisted
      const tournaments = store.listTournamentsByTask("planner");
      expect(tournaments).toHaveLength(1);
      expect(tournaments[0].winner).toBe("a");
      expect(tournaments[0].judge_reasoning).toBe("Variant A was more concise");
      expect(tournaments[0].judge_confidence).toBe(0.85);
      expect(tournaments[0].judged_at).not.toBeNull();
    });

    test("listTournamentsByTask returns tournaments ordered by created_at DESC", () => {
      store.createTournament({
        task: "planner",
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        eval_case_id: evalCase.id,
        segment_id: "default",
        model: "gpt-4o-mini",
      });
      // Second eval case for second tournament
      const ec2 = store.createEvalCase({ task: "planner", input: "Test 2" });
      store.createTournament({
        task: "planner",
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        eval_case_id: ec2.id,
        segment_id: "default",
        model: "gpt-4o-mini",
      });
      const tournaments = store.listTournamentsByTask("planner");
      expect(tournaments).toHaveLength(2);
    });

    test("listTournamentsByTask with limit", () => {
      store.createTournament({
        task: "planner",
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        eval_case_id: evalCase.id,
        segment_id: "default",
        model: "gpt-4o-mini",
      });
      const ec2 = store.createEvalCase({ task: "planner", input: "Test 2" });
      store.createTournament({
        task: "planner",
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        eval_case_id: ec2.id,
        segment_id: "default",
        model: "gpt-4o-mini",
      });
      const limited = store.listTournamentsByTask("planner", 1);
      expect(limited).toHaveLength(1);
    });

    test("countTournamentWins calculates wins, losses, ties", () => {
      const t1 = store.createTournament({
        task: "planner",
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        eval_case_id: evalCase.id,
        segment_id: "default",
        model: "gpt-4o-mini",
      });
      store.updateTournamentResult(t1.id, "a", "A wins", 0.9);

      const ec2 = store.createEvalCase({ task: "planner", input: "Test 2" });
      const t2 = store.createTournament({
        task: "planner",
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        eval_case_id: ec2.id,
        segment_id: "default",
        model: "gpt-4o-mini",
      });
      store.updateTournamentResult(t2.id, "b", "B wins", 0.8);

      const stats = store.countTournamentWins(variantA.id, "planner", "default");
      expect(stats.wins).toBe(1);
      expect(stats.losses).toBe(1);
      expect(stats.ties).toBe(0);
      expect(stats.total).toBe(2);
    });

    test("countTournamentWins with tie", () => {
      const t1 = store.createTournament({
        task: "planner",
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        eval_case_id: evalCase.id,
        segment_id: "default",
        model: "gpt-4o-mini",
      });
      store.updateTournamentResult(t1.id, "tie", "Equal quality", 0.5);

      const stats = store.countTournamentWins(variantA.id, "planner", "default");
      expect(stats.wins).toBe(0);
      expect(stats.losses).toBe(0);
      expect(stats.ties).toBe(1);
      expect(stats.total).toBe(1);
    });

    test("countTournamentWins counts wins when variant is B", () => {
      const t1 = store.createTournament({
        task: "planner",
        variant_a_id: variantA.id,
        variant_b_id: variantB.id,
        eval_case_id: evalCase.id,
        segment_id: "default",
        model: "gpt-4o-mini",
      });
      store.updateTournamentResult(t1.id, "b", "B wins as B", 0.9);

      const stats = store.countTournamentWins(variantB.id, "planner", "default");
      expect(stats.wins).toBe(1);
      expect(stats.losses).toBe(0);
      expect(stats.total).toBe(1);
    });
  });

  // --- Champions ---
  describe("Champion CRUD", () => {
    let variant: PromptVariant;

    beforeEach(() => {
      const genome = store.createGenome({ task: "planner", gene_ids: ["g1"] });
      variant = store.createVariant({ genome_id: genome.id, compiled_prompt: "Champ prompt", generation: 1 });
    });

    test("getChampion returns null when no champion exists", () => {
      expect(store.getChampion("planner", "default")).toBeNull();
    });

    test("setChampion creates a champion", () => {
      store.setChampion({
        task: "planner",
        segment_id: "default",
        variant_id: variant.id,
        model: "gpt-4o-mini",
        win_rate: 0.75,
        battle_count: 10,
        previous_variant_id: null,
      });
      const champ = store.getChampion("planner", "default");
      expect(champ).not.toBeNull();
      expect(champ!.variant_id).toBe(variant.id);
      expect(champ!.win_rate).toBe(0.75);
      expect(champ!.battle_count).toBe(10);
      expect(champ!.model).toBe("gpt-4o-mini");
      expect(champ!.is_locked).toBe(0);
    });

    test("setChampion replaces existing and creates history", () => {
      // Set first champion
      store.setChampion({
        task: "planner",
        segment_id: "default",
        variant_id: variant.id,
        model: "gpt-4o-mini",
        win_rate: 0.6,
        battle_count: 5,
        previous_variant_id: null,
      });

      // Create a second variant
      const genome = store.createGenome({ task: "planner", gene_ids: ["g2"] });
      const variant2 = store.createVariant({ genome_id: genome.id, compiled_prompt: "Better prompt", generation: 2 });

      // Replace champion
      store.setChampion({
        task: "planner",
        segment_id: "default",
        variant_id: variant2.id,
        model: "gpt-4o-mini",
        win_rate: 0.85,
        battle_count: 8,
        previous_variant_id: variant.id,
      });

      // Verify new champion
      const champ = store.getChampion("planner", "default");
      expect(champ!.variant_id).toBe(variant2.id);
      expect(champ!.win_rate).toBe(0.85);

      // Verify history was created for old champion
      const history = store.getChampionHistory("planner", "default");
      expect(history).toHaveLength(1);
      expect(history[0].variant_id).toBe(variant.id);
      expect(history[0].demotion_reason).toBe("superseded");
    });

    test("setChampion uses default model when not specified", () => {
      store.setChampion({
        task: "planner",
        segment_id: "default",
        variant_id: variant.id,
        win_rate: 0.7,
        battle_count: 3,
        previous_variant_id: null,
      });
      const champ = store.getChampion("planner", "default");
      expect(champ!.model).toBe("gpt-4o-mini");
    });

    test("lockChampion and unlockChampion toggle is_locked", () => {
      store.setChampion({
        task: "planner",
        segment_id: "default",
        variant_id: variant.id,
        model: "gpt-4o-mini",
        win_rate: 0.7,
        battle_count: 3,
        previous_variant_id: null,
      });

      store.lockChampion("planner", "default");
      let champ = store.getChampion("planner", "default");
      expect(champ!.is_locked).toBe(1);

      store.unlockChampion("planner", "default");
      champ = store.getChampion("planner", "default");
      expect(champ!.is_locked).toBe(0);
    });

    test("getChampionHistory returns empty array when no history", () => {
      store.setChampion({
        task: "planner",
        segment_id: "default",
        variant_id: variant.id,
        model: "gpt-4o-mini",
        win_rate: 0.7,
        battle_count: 3,
        previous_variant_id: null,
      });
      // First champion — no history yet
      const history = store.getChampionHistory("planner", "default");
      expect(history).toHaveLength(0);
    });

    test("rollbackChampion restores previous champion", () => {
      // First champion
      store.setChampion({
        task: "planner",
        segment_id: "default",
        variant_id: variant.id,
        model: "gpt-4o-mini",
        win_rate: 0.6,
        battle_count: 5,
        previous_variant_id: null,
      });

      // Second champion replaces first
      const genome = store.createGenome({ task: "planner", gene_ids: ["g2"] });
      const variant2 = store.createVariant({ genome_id: genome.id, compiled_prompt: "V2", generation: 2 });
      store.setChampion({
        task: "planner",
        segment_id: "default",
        variant_id: variant2.id,
        model: "gpt-4o-mini",
        win_rate: 0.85,
        battle_count: 8,
        previous_variant_id: variant.id,
      });

      // Rollback
      const rolled = store.rollbackChampion("planner", "default");
      expect(rolled).not.toBeNull();
      expect(rolled!.variant_id).toBe(variant.id);
    });

    test("rollbackChampion returns null when no previous_variant_id", () => {
      store.setChampion({
        task: "planner",
        segment_id: "default",
        variant_id: variant.id,
        model: "gpt-4o-mini",
        win_rate: 0.7,
        battle_count: 3,
        previous_variant_id: null,
      });
      expect(store.rollbackChampion("planner", "default")).toBeNull();
    });

    test("rollbackChampion returns null when no champion exists", () => {
      expect(store.rollbackChampion("planner", "default")).toBeNull();
    });
  });
});
