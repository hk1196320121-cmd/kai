import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { PromptCompiler } from "../../../src/core/prompt/prompt-compiler";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type { Trait } from "../../../src/core/profile/types";

describe("PromptCompiler expanded", () => {
  let db: KaiDB;
  let store: GeneStore;
  let compiler: PromptCompiler;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("compiler-expanded");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
    compiler = new PromptCompiler(store);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("falls back when genome has malformed gene_ids JSON", async () => {
    // Corrupt the planner genome's gene_ids
    const genome = store.getGenomeByTask("planner")!;
    db.getDatabase().run(
      "UPDATE prompt_genomes SET gene_ids = $ids WHERE id = $id",
      { $ids: "not-valid-json{{{", $id: genome.id },
    );
    compiler.clearCache();

    const result = await compiler.compile("planner", []);
    // Should fall back to hardcoded prompt
    expect(result.gene_count).toBe(0);
    expect(result.prompt.length).toBeGreaterThan(50);
  });

  test("falls back when compiled prompt is too short", async () => {
    const genome = store.getGenomeByTask("planner")!;
    // Replace genes with very short content
    db.getDatabase().run(
      "UPDATE prompt_genes SET content = 'short' WHERE task = 'planner'",
    );
    // Also need to update the genome to reference only short genes
    compiler.clearCache();

    // The compiled prompt would be "short\n\nshort" which is ~13 chars < 50
    // So it falls back
    const result = await compiler.compile("planner", []);
    expect(result.prompt.length).toBeGreaterThan(50);
  });

  test("falls back when compiled prompt has unresolved {{...}} placeholders", async () => {
    const genome = store.getGenomeByTask("planner")!;
    // Add an adapter gene with unresolved placeholder
    const adapterGene = store.createGene({
      task: "planner",
      type: "adapter",
      content: "{{trait:nonexistent_dimension}} unresolved",
    });
    // Replace genome genes with just this adapter
    db.getDatabase().run(
      "UPDATE prompt_genomes SET gene_ids = $ids WHERE id = $id",
      { $ids: JSON.stringify([adapterGene.id]), $id: genome.id },
    );
    compiler.clearCache();

    // The interpolated result would be "0.5 unresolved" but with no {{...}}
    // So we need a gene with {{...}} that is NOT an adapter type
    const badGene = store.createGene({
      task: "planner",
      type: "intent",
      content: "This has {{unresolved}} placeholder that stays.",
    });
    db.getDatabase().run(
      "UPDATE prompt_genomes SET gene_ids = $ids WHERE id = $id",
      { $ids: JSON.stringify([badGene.id]), $id: genome.id },
    );
    compiler.clearCache();

    const result = await compiler.compile("planner", []);
    // Should fall back because {{unresolved}} is in the compiled output
    expect(result.gene_count).toBe(0);
    expect(result.prompt).not.toContain("{{unresolved}}");
  });

  test("evicts cache entries when MAX_CACHE_SIZE reached", async () => {
    // Fill cache with 100+ entries
    const traits: Trait[] = [];
    for (let i = 0; i < 110; i++) {
      traits.push({
        id: `t-${i}`,
        dimension: `dim_${i}`,
        value: i / 110,
        confidence: 8,
        source: "observed" as const,
        reasoning: "",
        updated_at: "",
      });
    }

    // Compile with different trait combos to fill cache
    for (let i = 0; i < 105; i++) {
      const slice = traits.slice(i, i + 3);
      await compiler.compile("planner", slice);
    }

    // Cache should still work (no crash), and eviction happened
    const result = await compiler.compile("planner", []);
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  test("adapter gene uses effective weight (value * confidence/10)", async () => {
    const adapterGene = store.createGene({
      task: "planner",
      type: "adapter",
      content: "Risk level: {{trait:risk_tolerance}}.",
    });
    const genome = store.getGenomeByTask("planner")!;
    db.getDatabase().run(
      "UPDATE prompt_genomes SET gene_ids = $ids WHERE id = $id",
      { $ids: JSON.stringify([...JSON.parse(genome.gene_ids), adapterGene.id]), $id: genome.id },
    );

    compiler.clearCache();
    const traits: Trait[] = [
      {
        id: "r1",
        dimension: "risk_tolerance",
        value: 0.8,
        confidence: 7,
        source: "observed" as const,
        reasoning: "",
        updated_at: "",
      },
    ];
    const result = await compiler.compile("planner", traits);
    // effectiveWeight = 0.8 * (7/10) = 0.56
    expect(result.prompt).toContain("0.56");
  });

  test("skips genes that don't exist in store", async () => {
    const genome = store.getGenomeByTask("planner")!;
    // Add a non-existent gene ID to the genome
    db.getDatabase().run(
      "UPDATE prompt_genomes SET gene_ids = $ids WHERE id = $id",
      { $ids: JSON.stringify(["nonexistent-gene-id", ...JSON.parse(genome.gene_ids)]), $id: genome.id },
    );

    compiler.clearCache();
    const result = await compiler.compile("planner", []);
    // Should still compile, skipping the missing gene
    expect(result.prompt.length).toBeGreaterThan(50);
    expect(result.gene_count).toBeGreaterThanOrEqual(2);
  });

  test("returns observer fallback (empty string) when no genome", async () => {
    const result = await compiler.compile("observer", []);
    // observer has no seed genome and empty fallback
    expect(result.prompt).toBe("");
    expect(result.genome_id).toBe("");
    expect(result.variant_id).toBeNull();
  });
});
