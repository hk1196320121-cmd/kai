import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { PromptCompiler } from "../../../src/core/prompt/prompt-compiler";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type { Trait } from "../../../src/core/profile/types";

describe("Advanced Genes", () => {
  let db: KaiDB;
  let store: GeneStore;
  let compiler: PromptCompiler;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("advanced-genes");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
    compiler = new PromptCompiler(store);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  function makeTrait(dimension: string, value: number): Trait {
    return { id: dimension, dimension, value, confidence: 8, source: "observed" as const, reasoning: "", updated_at: "" };
  }

  test("AdapterGene interpolates {{trait:dimension}} with profile value", async () => {
    const adapterGene = store.createGene({
      task: "planner",
      type: "adapter",
      content: "User detail preference: {{trait:detail_oriented}}. Adjust granularity accordingly.",
      trait_bindings: JSON.stringify({ dimensions: ["detail_oriented"] }),
    });

    const genome = store.getGenomeByTask("planner")!;
    const geneIds: string[] = JSON.parse(genome.gene_ids);
    geneIds.push(adapterGene.id);
    db.getDatabase().run("UPDATE prompt_genomes SET gene_ids = $ids WHERE id = $id", {
      $ids: JSON.stringify(geneIds),
      $id: genome.id,
    });

    compiler.clearCache();
    const traits = [makeTrait("detail_oriented", 0.85)];
    const result = await compiler.compile("planner", traits);
    expect(result.prompt).toContain("0.68");
    expect(result.prompt).not.toContain("{{trait:detail_oriented}}");
  });

  test("AdapterGene uses 0.5 default for missing traits", async () => {
    const adapterGene = store.createGene({
      task: "planner",
      type: "adapter",
      content: "Risk level: {{trait:risk_tolerance}}.",
      trait_bindings: JSON.stringify({ dimensions: ["risk_tolerance"] }),
    });

    const genome = store.getGenomeByTask("planner")!;
    const geneIds: string[] = JSON.parse(genome.gene_ids);
    geneIds.push(adapterGene.id);
    db.getDatabase().run("UPDATE prompt_genomes SET gene_ids = $ids WHERE id = $id", {
      $ids: JSON.stringify(geneIds),
      $id: genome.id,
    });

    compiler.clearCache();
    const result = await compiler.compile("planner", []);
    expect(result.prompt).toContain("0.5");
    expect(result.prompt).not.toContain("{{trait:");
  });

  test("ExampleGene adds few-shot examples to prompt", async () => {
    const exampleGene = store.createGene({
      task: "planner",
      type: "example",
      content: "Example: For 'build auth system', produce tasks: 1) Design schema, 2) Implement JWT, 3) Write tests.",
    });

    const genome = store.getGenomeByTask("planner")!;
    const geneIds: string[] = JSON.parse(genome.gene_ids);
    geneIds.push(exampleGene.id);
    db.getDatabase().run("UPDATE prompt_genomes SET gene_ids = $ids WHERE id = $id", {
      $ids: JSON.stringify(geneIds),
      $id: genome.id,
    });

    compiler.clearCache();
    const result = await compiler.compile("planner", []);
    expect(result.prompt).toContain("Example: For 'build auth system'");
  });

  test("ToneGene adjusts communication style", async () => {
    const toneGene = store.createGene({
      task: "planner",
      type: "tone",
      content: "Be concise and actionable. Avoid unnecessary explanation.",
    });

    const genome = store.getGenomeByTask("planner")!;
    const geneIds: string[] = JSON.parse(genome.gene_ids);
    geneIds.push(toneGene.id);
    db.getDatabase().run("UPDATE prompt_genomes SET gene_ids = $ids WHERE id = $id", {
      $ids: JSON.stringify(geneIds),
      $id: genome.id,
    });

    compiler.clearCache();
    const result = await compiler.compile("planner", []);
    expect(result.prompt).toContain("Be concise and actionable");
  });
});
