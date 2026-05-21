import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";

describe("V6 Migration", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-v6-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {}
    }
  });

  test("creates all 8 prompt tables", () => {
    const tables = db.listTables();
    const expected = [
      "prompt_genes",
      "prompt_genomes",
      "prompt_variants",
      "prompt_segments",
      "prompt_eval_cases",
      "prompt_tournaments",
      "prompt_champions",
      "prompt_champion_history",
    ];
    for (const table of expected) {
      expect(tables).toContain(table);
    }
  });

  test("prompt_genes enforces type CHECK constraint", () => {
    const database = db.getDatabase();
    expect(() => {
      database.run(
        `INSERT INTO prompt_genes (id, task, type, content) VALUES ('bad-type', 'planner', 'invalid', 'test')`,
      );
    }).toThrow();
  });

  test("prompt_genes enforces task CHECK constraint", () => {
    const database = db.getDatabase();
    expect(() => {
      database.run(
        `INSERT INTO prompt_genes (id, task, type, content) VALUES ('bad-task', 'invalid', 'intent', 'test')`,
      );
    }).toThrow();
  });

  test("prompt_tournaments enforces winner CHECK constraint", () => {
    const database = db.getDatabase();
    // Setup required FK records
    database.run(
      `INSERT INTO prompt_genomes (id, task, gene_ids) VALUES ('tg-1', 'planner', '[]')`,
    );
    database.run(
      `INSERT INTO prompt_variants (id, genome_id, compiled_prompt, generation) VALUES ('tv-1', 'tg-1', 'prompt', 1)`,
    );
    database.run(
      `INSERT INTO prompt_variants (id, genome_id, compiled_prompt, generation) VALUES ('tv-2', 'tg-1', 'prompt', 1)`,
    );
    database.run(
      `INSERT INTO prompt_eval_cases (id, task, input) VALUES ('tec-1', 'planner', 'test input')`,
    );
    expect(() => {
      database.run(
        `INSERT INTO prompt_tournaments (id, task, variant_a_id, variant_b_id, eval_case_id, model, winner)
         VALUES ('tt-1', 'planner', 'tv-1', 'tv-2', 'tec-1', 'gpt-4o-mini', 'invalid')`,
      );
    }).toThrow();
  });

  test("prompt_champions UNIQUE on (task, segment_id, model)", () => {
    const database = db.getDatabase();
    // Setup FK records
    database.run(
      `INSERT INTO prompt_genomes (id, task, gene_ids) VALUES ('cg-1', 'planner', '[]')`,
    );
    database.run(
      `INSERT INTO prompt_segments (id, name, trait_constraints) VALUES ('seg-unique', 'test', '{}')`,
    );
    database.run(
      `INSERT INTO prompt_variants (id, genome_id, compiled_prompt, generation) VALUES ('cv-1', 'cg-1', 'prompt', 1)`,
    );
    database.run(
      `INSERT INTO prompt_variants (id, genome_id, compiled_prompt, generation) VALUES ('cv-2', 'cg-1', 'prompt', 1)`,
    );
    database.run(
      `INSERT INTO prompt_champions (id, task, segment_id, variant_id, model, win_rate, battle_count)
       VALUES ('ch-1', 'planner', 'seg-unique', 'cv-1', 'gpt-4o-mini', 0.8, 10)`,
    );
    expect(() => {
      database.run(
        `INSERT INTO prompt_champions (id, task, segment_id, variant_id, model, win_rate, battle_count)
         VALUES ('ch-2', 'planner', 'seg-unique', 'cv-2', 'gpt-4o-mini', 0.9, 12)`,
      );
    }).toThrow();
  });

  test("seeds default segment", () => {
    const database = db.getDatabase();
    const row = database
      .query("SELECT * FROM prompt_segments WHERE id = 'default'")
      .get() as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe("default");
  });

  test("seeds planner IntentGene and ContractGene", () => {
    const database = db.getDatabase();
    const rows = database
      .query(
        "SELECT type FROM prompt_genes WHERE task = 'planner' ORDER BY type",
      )
      .all() as { type: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const types = rows.map((r) => r.type);
    expect(types).toContain("intent");
    expect(types).toContain("contract");
  });

  test("seeds default planner genome", () => {
    const database = db.getDatabase();
    const row = database
      .query("SELECT * FROM prompt_genomes WHERE id = 'genome-planner-default'")
      .get() as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.task).toBe("planner");
    const geneIds = JSON.parse(row.gene_ids as string);
    expect(geneIds).toContain("planner-intent-v1");
    expect(geneIds).toContain("planner-contract-v1");
  });

  test("preserves existing data through migration", () => {
    const database = db.getDatabase();
    database.run(
      `INSERT INTO observations (type, key, value, confidence, source, provenance)
       VALUES ('behavior', 'pre-v6:test', '{"action":"test"}', 7, 'mcp', '{}')`,
    );
    const row = database
      .query("SELECT * FROM observations WHERE key = 'pre-v6:test'")
      .get() as Record<string, unknown>;
    expect(row.confidence).toBe(7);
  });

  test("migration is idempotent — init twice does not error", () => {
    db.close();
    const db2 = new KaiDB(dbPath);
    const tables = db2.listTables();
    const expected = [
      "prompt_genes",
      "prompt_genomes",
      "prompt_variants",
      "prompt_segments",
      "prompt_eval_cases",
      "prompt_tournaments",
      "prompt_champions",
      "prompt_champion_history",
    ];
    for (const table of expected) {
      expect(tables).toContain(table);
    }
    db2.close();
  });
});
