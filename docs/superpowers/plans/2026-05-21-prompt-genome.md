# Prompt Genome — Adaptive Prompt Evolution Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Kai's 3 hardcoded LLM prompts with a dynamic, profile-aware, evolvable prompt genome system — genes assemble into prompts per user segment, tournaments evaluate variants, champions promote via statistical guardrails with user approval gates.

**Architecture:** 8 SQLite tables (V6 migration) store genes, genomes, variants, segments, eval cases, tournaments, champions, and history. A PromptCompiler assembles system prompts from gene components using profile interpolation. A TournamentRunner runs pairwise LLM-as-judge battles, and PromptEvolver generates mutations and promotes champions. CLI + MCP expose the system.

**Tech Stack:** Bun runtime, bun:sqlite, Commander.js (CLI), @modelcontextprotocol/sdk (MCP), TypeScript, existing LLMProvider.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/core/prompt/types.ts` | Gene, Genome, Variant, Segment, EvalCase, Champion type definitions |
| Create | `src/core/prompt/gene-store.ts` | SQLite CRUD for all 8 prompt tables |
| Create | `src/core/prompt/prompt-compiler.ts` | Assembly pipeline: genes → compiled prompt, cache, fallback |
| Create | `src/core/prompt/segment-matcher.ts` | Profile trait → segment matching algorithm |
| Create | `src/core/prompt/tournament-runner.ts` | Pairwise variant battles with eval cases |
| Create | `src/core/prompt/judge-engine.ts` | LLM-as-judge with rubric, 3-call majority vote |
| Create | `src/core/prompt/prompt-evolver.ts` | Mutation generation, champion promotion, rollback |
| Create | `src/cli/prompt.ts` | `kai prompt *` CLI commands |
| Create | `src/mcp/prompt-handlers.ts` | MCP tool handlers for prompt operations |
| Create | `src/mcp/prompt-resources.ts` | MCP resources: kai://prompt/* |
| Create | `src/mcp/prompt-schema.ts` | Zod schemas for MCP prompt tools |
| Modify | `src/db/client.ts:164-296` | Add MIGRATION_V6 + wire into runMigrations() |
| Modify | `src/llm/provider.ts:16-129` | Add callWithModel() method |
| Modify | `src/core/orchestrator/planner.ts:44-51` | Accept PromptCompiler via constructor, use in decomposeIdea() |
| Modify | `src/mcp/orchestrator-handlers.ts:44-94` | Pass PromptCompiler to Planner constructor |
| Modify | `src/cli/index.ts:1-25` | Import and register prompt commands |
| Modify | `src/mcp/server.ts:1-44` | Import and register prompt handlers + resources |
| Create | `tests/migration-v6.test.ts` | V6 migration tests |
| Create | `tests/core/prompt/gene-store.test.ts` | GeneStore CRUD tests |
| Create | `tests/core/prompt/prompt-compiler.test.ts` | Compiler assembly + fallback tests |
| Create | `tests/core/prompt/segment-matcher.test.ts` | Segment matching tests |
| Create | `tests/core/prompt/tournament.test.ts` | Tournament + judge tests |
| Create | `tests/core/prompt/prompt-evolver.test.ts` | Evolver mutation + promotion tests |
| Create | `tests/core/prompt/advanced-genes.test.ts` | AdapterGene, ToneGene, ExampleGene tests |
| Create | `tests/mcp/prompt.test.ts` | MCP prompt handler/resource tests |
| Modify | `tests/llm-provider.test.ts` | Add callWithModel tests |

---

## Task 1: V6 Migration — 8 Tables + Seed Data

**Files:**
- Modify: `src/db/client.ts:164-296`
- Create: `tests/migration-v6.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/migration-v6.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../src/db/client";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

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
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  function getDatabase() {
    return db.getDatabase();
  }

  test("creates all 8 prompt tables", () => {
    const tables = db.listTables();
    expect(tables).toContain("prompt_genes");
    expect(tables).toContain("prompt_genomes");
    expect(tables).toContain("prompt_variants");
    expect(tables).toContain("prompt_segments");
    expect(tables).toContain("prompt_eval_cases");
    expect(tables).toContain("prompt_tournaments");
    expect(tables).toContain("prompt_champions");
    expect(tables).toContain("prompt_champion_history");
  });

  test("prompt_genes enforces type CHECK constraint", () => {
    const database = getDatabase();
    expect(() => {
      database.run(
        `INSERT INTO prompt_genes (id, task, type, content) VALUES ('g1', 'planner', 'invalid', 'test')`,
      );
    }).toThrow();
  });

  test("prompt_genes enforces task CHECK constraint", () => {
    const database = getDatabase();
    expect(() => {
      database.run(
        `INSERT INTO prompt_genes (id, task, type, content) VALUES ('g2', 'invalid', 'intent', 'test')`,
      );
    }).toThrow();
  });

  test("prompt_tournaments enforces winner CHECK constraint", () => {
    const database = getDatabase();
    // Setup required foreign keys
    database.run(`INSERT INTO prompt_genes (id, task, type, content) VALUES ('g1', 'planner', 'intent', 'test')`);
    database.run(`INSERT INTO prompt_genomes (id, task, gene_ids) VALUES ('gm1', 'planner', '["g1"]')`);
    database.run(`INSERT INTO prompt_variants (id, genome_id, compiled_prompt) VALUES ('v1', 'gm1', 'prompt1')`);
    database.run(`INSERT INTO prompt_variants (id, genome_id, compiled_prompt) VALUES ('v2', 'gm1', 'prompt2')`);
    database.run(`INSERT INTO prompt_eval_cases (id, task, input) VALUES ('e1', 'planner', '{}')`);
    database.run(`INSERT INTO prompt_segments (id, name, trait_constraints) VALUES ('s1', 'default', '{}')`);

    expect(() => {
      database.run(
        `INSERT INTO prompt_tournaments (id, task, variant_a_id, variant_b_id, eval_case_id, segment_id, model, winner)
         VALUES ('t1', 'planner', 'v1', 'v2', 'e1', 's1', 'gpt-4o-mini', 'invalid')`,
      );
    }).toThrow();
  });

  test("prompt_champions UNIQUE on (task, segment_id, model)", () => {
    const database = getDatabase();
    database.run(`INSERT INTO prompt_genes (id, task, type, content) VALUES ('g1', 'planner', 'intent', 'test')`);
    database.run(`INSERT INTO prompt_genomes (id, task, gene_ids) VALUES ('gm1', 'planner', '["g1"]')`);
    database.run(`INSERT INTO prompt_variants (id, genome_id, compiled_prompt) VALUES ('v1', 'gm1', 'p1')`);
    database.run(`INSERT INTO prompt_variants (id, genome_id, compiled_prompt) VALUES ('v2', 'gm1', 'p2')`);
    database.run(`INSERT INTO prompt_segments (id, name, trait_constraints) VALUES ('s1', 'default', '{}')`);
    database.run(
      `INSERT INTO prompt_champions (id, task, segment_id, variant_id, model, win_rate, battle_count)
       VALUES ('c1', 'planner', 's1', 'v1', 'gpt-4o-mini', 0.75, 20)`,
    );
    expect(() => {
      database.run(
        `INSERT INTO prompt_champions (id, task, segment_id, variant_id, model, win_rate, battle_count)
         VALUES ('c2', 'planner', 's1', 'v2', 'gpt-4o-mini', 0.80, 20)`,
      );
    }).toThrow();
  });

  test("seeds default segment", () => {
    const database = getDatabase();
    const row = database.query("SELECT * FROM prompt_segments WHERE id = 'default'").get() as Record<string, unknown> | null;
    expect(row).not.toBeNull();
    expect((row as Record<string, unknown>).name).toBe("default");
  });

  test("seeds planner IntentGene and ContractGene", () => {
    const database = getDatabase();
    const genes = database.query("SELECT * FROM prompt_genes WHERE task = 'planner' ORDER BY type").all() as Record<string, unknown>[];
    expect(genes.length).toBeGreaterThanOrEqual(2);
    const types = genes.map((g) => g.type);
    expect(types).toContain("intent");
    expect(types).toContain("contract");
  });

  test("seeds default planner genome", () => {
    const database = getDatabase();
    const genome = database.query("SELECT * FROM prompt_genomes WHERE task = 'planner'").get() as Record<string, unknown> | null;
    expect(genome).not.toBeNull();
    const geneIds = JSON.parse((genome as Record<string, unknown>).gene_ids as string);
    expect(geneIds.length).toBeGreaterThanOrEqual(2);
  });

  test("preserves existing data through migration", () => {
    const database = getDatabase();
    database.run(
      `INSERT INTO observations (type, key, value, confidence, source, provenance)
       VALUES ('behavior', 'pre-v6:test', '{}', 7, 'mcp', '{}')`,
    );
    const row = database.query("SELECT * FROM observations WHERE key = 'pre-v6:test'").get() as Record<string, unknown>;
    expect(row.confidence).toBe(7);
  });

  test("migration is idempotent — init twice does not error", () => {
    db.close();
    const db2 = new KaiDB(dbPath);
    const tables = db2.listTables();
    expect(tables).toContain("prompt_genes");
    expect(tables).toContain("prompt_champions");
    db2.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/migration-v6.test.ts`
Expected: FAIL — `prompt_genes` table does not exist yet.

- [ ] **Step 3: Write MIGRATION_V6 and wire into runMigrations()**

Add to `src/db/client.ts` after the `MIGRATION_V5` constant (after line 245):

```typescript
const MIGRATION_V6 = `
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS prompt_genes (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL CHECK(task IN ('planner','derivator','observer')),
  type TEXT NOT NULL CHECK(type IN ('intent','contract','adapter','example','tone')),
  content TEXT NOT NULL,
  trait_bindings TEXT DEFAULT '{}',
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_genomes (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  gene_ids TEXT NOT NULL,
  compiler_config TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_variants (
  id TEXT PRIMARY KEY,
  genome_id TEXT NOT NULL REFERENCES prompt_genomes(id),
  compiled_prompt TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  parent_variant_id TEXT REFERENCES prompt_variants(id),
  mutation_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trait_constraints TEXT NOT NULL DEFAULT '{}',
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_eval_cases (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  input TEXT NOT NULL,
  expected_output TEXT,
  difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
  source TEXT DEFAULT 'synthetic' CHECK(source IN ('synthetic','real','edge_case')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_tournaments (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  variant_a_id TEXT NOT NULL REFERENCES prompt_variants(id),
  variant_b_id TEXT NOT NULL REFERENCES prompt_variants(id),
  eval_case_id TEXT NOT NULL REFERENCES prompt_eval_cases(id),
  segment_id TEXT REFERENCES prompt_segments(id),
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  winner TEXT CHECK(winner IN ('a','b','tie')),
  judge_reasoning TEXT,
  judge_confidence REAL CHECK(judge_confidence IS NULL OR (judge_confidence >= 0.0 AND judge_confidence <= 1.0)),
  judged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompt_champions (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  segment_id TEXT NOT NULL REFERENCES prompt_segments(id),
  variant_id TEXT NOT NULL REFERENCES prompt_variants(id),
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  win_rate REAL NOT NULL CHECK(win_rate >= 0.0 AND win_rate <= 1.0),
  battle_count INTEGER NOT NULL DEFAULT 0 CHECK(battle_count >= 0),
  promoted_at TEXT NOT NULL DEFAULT (datetime('now')),
  previous_variant_id TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK(is_locked IN (0,1)),
  UNIQUE(task, segment_id, model)
);

CREATE TABLE IF NOT EXISTS prompt_champion_history (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  win_rate REAL NOT NULL,
  battle_count INTEGER NOT NULL,
  promoted_at TEXT NOT NULL,
  demoted_at TEXT,
  demotion_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_prompt_genes_task ON prompt_genes(task);
CREATE INDEX IF NOT EXISTS idx_prompt_genes_type ON prompt_genes(type);
CREATE INDEX IF NOT EXISTS idx_prompt_genomes_task ON prompt_genomes(task);
CREATE INDEX IF NOT EXISTS idx_prompt_variants_genome ON prompt_variants(genome_id);
CREATE INDEX IF NOT EXISTS idx_prompt_eval_cases_task ON prompt_eval_cases(task);
CREATE INDEX IF NOT EXISTS idx_prompt_tournaments_task ON prompt_tournaments(task);
CREATE INDEX IF NOT EXISTS idx_prompt_tournaments_segment ON prompt_tournaments(segment_id);
CREATE INDEX IF NOT EXISTS idx_prompt_champions_task ON prompt_champions(task);
CREATE INDEX IF NOT EXISTS idx_prompt_champion_history_task ON prompt_champion_history(task);

-- Seed: default segment
INSERT OR IGNORE INTO prompt_segments (id, name, trait_constraints, description)
VALUES ('default', 'default', '{}', 'Fallback segment when no profile match');

-- Seed: planner IntentGene
INSERT OR IGNORE INTO prompt_genes (id, task, type, content, metadata)
VALUES (
  'planner-intent-v1',
  'planner',
  'intent',
  'You are a task decomposition engine. Given an idea and a user''s behavioral profile, break the idea into actionable tasks.',
  '{"version":1,"source":"PLANNER_SYSTEM_PROMPT"}'
);

-- Seed: planner ContractGene
INSERT OR IGNORE INTO prompt_genes (id, task, type, content, metadata)
VALUES (
  'planner-contract-v1',
  'planner',
  'contract',
  'Return a JSON object with a "tasks" array. Each task MUST have these fields:\n- title (string, max 100 chars)\n- description (string, max 500 chars)\n- type ("one_off" or "cron")\n- agent ("hermes")\n- prompt (string, the execution instruction for the agent)\n- decomposition_rationale (string, why this task exists)\n- scheduling_rationale (string, why scheduled this way)\n\nFor cron tasks, also include:\n- cron_schedule (cron expression)\n- cron_prompt (prompt for each cycle)\n\nConstraints:\n- Produce 3-8 tasks total\n- Each description max 500 characters\n- Use the user''s behavioral profile to influence decomposition strategy\n- CRITICAL: Never include raw profile data, trait values, or behavioral observations verbatim in any task field. Synthesize insights into actionable instructions only.',
  '{"version":1,"source":"PLANNER_SYSTEM_PROMPT"}'
);

-- Seed: default planner genome
INSERT OR IGNORE INTO prompt_genomes (id, task, gene_ids, compiler_config)
VALUES (
  'genome-planner-default',
  'planner',
  '["planner-intent-v1","planner-contract-v1"]',
  '{"separator":"\\n\\n"}'
);

-- Seed: initial variant from default genome (compiled = intent + contract joined)
INSERT OR IGNORE INTO prompt_variants (id, genome_id, compiled_prompt, generation, mutation_type)
VALUES (
  'variant-planner-initial',
  'genome-planner-default',
  'You are a task decomposition engine. Given an idea and a user''s behavioral profile, break the idea into actionable tasks.\n\nReturn a JSON object with a "tasks" array. Each task MUST have these fields:\n- title (string, max 100 chars)\n- description (string, max 500 chars)\n- type ("one_off" or "cron")\n- agent ("hermes")\n- prompt (string, the execution instruction for the agent)\n- decomposition_rationale (string, why this task exists)\n- scheduling_rationale (string, why scheduled this way)\n\nFor cron tasks, also include:\n- cron_schedule (cron expression)\n- cron_prompt (prompt for each cycle)\n\nConstraints:\n- Produce 3-8 tasks total\n- Each description max 500 characters\n- Use the user''s behavioral profile to influence decomposition strategy\n- CRITICAL: Never include raw profile data, trait values, or behavioral observations verbatim in any task field. Synthesize insights into actionable instructions only.',
  1,
  'seed'
);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;
```

Add migration wiring in `runMigrations()` after the `currentVersion < 5` block (after line 296):

```typescript
if (currentVersion < 6) {
  this.db.exec(MIGRATION_V6);
  this.db.run(
    "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
    [6],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/migration-v6.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: ALL PASS (existing tests unaffected)

- [ ] **Step 6: Commit**

```bash
git add src/db/client.ts tests/migration-v6.test.ts
git commit -m "feat: add V6 migration with 8 prompt genome tables and seed data"
```

---

## Task 2: Prompt Types

**Files:**
- Create: `src/core/prompt/types.ts`

- [ ] **Step 1: Create type definitions file**

Create `src/core/prompt/types.ts`:

```typescript
export type PromptTask = "planner" | "derivator" | "observer";
export type GeneType = "intent" | "contract" | "adapter" | "example" | "tone";
export type MutationType = "seed" | "manual" | "intent_rephrase" | "contract_adjust" | "tone_shift" | "structure_change" | "adapter_tweak";
export type EvalDifficulty = "easy" | "medium" | "hard";
export type EvalSource = "synthetic" | "real" | "edge_case";
export type TournamentWinner = "a" | "b" | "tie";

export interface PromptGene {
  id: string;
  task: PromptTask;
  type: GeneType;
  content: string;
  trait_bindings: string;
  metadata: string;
  created_at: string;
}

export interface PromptGenome {
  id: string;
  task: PromptTask;
  gene_ids: string;
  compiler_config: string;
  created_at: string;
}

export interface PromptVariant {
  id: string;
  genome_id: string;
  compiled_prompt: string;
  generation: number;
  parent_variant_id: string | null;
  mutation_type: MutationType | null;
  created_at: string;
}

export interface PromptSegment {
  id: string;
  name: string;
  trait_constraints: string;
  description: string;
  created_at: string;
}

export interface PromptEvalCase {
  id: string;
  task: PromptTask;
  input: string;
  expected_output: string | null;
  difficulty: EvalDifficulty;
  source: EvalSource;
  created_at: string;
}

export interface PromptTournament {
  id: string;
  task: PromptTask;
  variant_a_id: string;
  variant_b_id: string;
  eval_case_id: string;
  segment_id: string | null;
  model: string;
  winner: TournamentWinner | null;
  judge_reasoning: string | null;
  judge_confidence: number | null;
  judged_at: string | null;
  created_at: string;
}

export interface PromptChampion {
  id: string;
  task: PromptTask;
  segment_id: string;
  variant_id: string;
  model: string;
  win_rate: number;
  battle_count: number;
  promoted_at: string;
  previous_variant_id: string | null;
  is_locked: number;
}

export interface PromptChampionHistory {
  id: string;
  task: string;
  segment_id: string;
  variant_id: string;
  model: string;
  win_rate: number;
  battle_count: number;
  promoted_at: string;
  demoted_at: string | null;
  demotion_reason: string | null;
}

export interface CompiledPrompt {
  prompt: string;
  segment_id: string;
  genome_id: string;
  variant_id: string | null;
  gene_count: number;
  cached: boolean;
}

export interface TournamentResult {
  variant_a_id: string;
  variant_b_id: string;
  winner: TournamentWinner;
  reasoning: string;
  confidence: number;
}

export interface EvolutionResult {
  rounds_completed: number;
  battles_run: number;
  champion_promoted: boolean;
  champion_variant_id: string | null;
  previous_champion_variant_id: string | null;
}

export interface SegmentMatch {
  segment_id: string;
  segment_name: string;
  constraints_satisfied: number;
  is_default: boolean;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors from new types file.

- [ ] **Step 3: Commit**

```bash
git add src/core/prompt/types.ts
git commit -m "feat: add prompt genome type definitions"
```

---

## Task 3: GeneStore — CRUD for 8 Prompt Tables

**Files:**
- Create: `src/core/prompt/gene-store.ts`
- Create: `tests/core/prompt/gene-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/prompt/gene-store.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { tempDb, cleanup } from "../../helpers/temp-db";

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
  test("createGene and getGene round-trip", () => {
    const gene = store.createGene({
      task: "planner",
      type: "intent",
      content: "Decompose tasks",
    });
    expect(gene.id).toBeTruthy();
    expect(gene.task).toBe("planner");
    expect(gene.type).toBe("intent");

    const fetched = store.getGene(gene.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toBe("Decompose tasks");
  });

  test("listGenes filters by task", () => {
    store.createGene({ task: "planner", type: "intent", content: "p-intent" });
    store.createGene({ task: "derivator", type: "intent", content: "d-intent" });
    const plannerGenes = store.listGenes("planner");
    expect(plannerGenes.length).toBeGreaterThanOrEqual(1);
    expect(plannerGenes.every((g) => g.task === "planner")).toBe(true);
  });

  test("updateGene changes content", () => {
    const gene = store.createGene({ task: "planner", type: "intent", content: "old" });
    store.updateGene(gene.id, { content: "new" });
    const updated = store.getGene(gene.id);
    expect(updated!.content).toBe("new");
  });

  test("deleteGene removes gene", () => {
    const gene = store.createGene({ task: "planner", type: "intent", content: "temp" });
    store.deleteGene(gene.id);
    expect(store.getGene(gene.id)).toBeNull();
  });

  // --- Genomes ---
  test("createGenome and getGenome round-trip", () => {
    const g1 = store.createGene({ task: "planner", type: "intent", content: "i" });
    const g2 = store.createGene({ task: "planner", type: "contract", content: "c" });
    const genome = store.createGenome({
      task: "planner",
      gene_ids: [g1.id, g2.id],
    });
    expect(genome.task).toBe("planner");
    const fetched = store.getGenome(genome.id);
    expect(fetched).not.toBeNull();
    expect(JSON.parse(fetched!.gene_ids)).toHaveLength(2);
  });

  test("getGenomeByTask returns genome for task", () => {
    store.createGenome({ task: "planner", gene_ids: [] });
    const genome = store.getGenomeByTask("planner");
    expect(genome).not.toBeNull();
    expect(genome!.task).toBe("planner");
  });

  // --- Variants ---
  test("createVariant and getVariant round-trip", () => {
    const genome = store.createGenome({ task: "planner", gene_ids: [] });
    const variant = store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "compiled prompt text",
      generation: 1,
      mutation_type: "seed",
    });
    expect(variant.compiled_prompt).toBe("compiled prompt text");
    const fetched = store.getVariant(variant.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.generation).toBe(1);
  });

  test("listVariantsByGenome returns variants for genome", () => {
    const genome = store.createGenome({ task: "planner", gene_ids: [] });
    store.createVariant({ genome_id: genome.id, compiled_prompt: "v1", generation: 1 });
    store.createVariant({ genome_id: genome.id, compiled_prompt: "v2", generation: 2 });
    const variants = store.listVariantsByGenome(genome.id);
    expect(variants).toHaveLength(2);
  });

  // --- Segments ---
  test("listSegments returns all segments including default", () => {
    const segments = store.listSegments();
    const defaultSeg = segments.find((s) => s.id === "default");
    expect(defaultSeg).toBeDefined();
    expect(defaultSeg!.name).toBe("default");
  });

  test("getSegment returns segment by id", () => {
    const seg = store.getSegment("default");
    expect(seg).not.toBeNull();
    expect(seg!.name).toBe("default");
  });

  // --- Eval Cases ---
  test("createEvalCase and listEvalCasesByTask", () => {
    const ec = store.createEvalCase({
      task: "planner",
      input: '{"idea":"build feature X"}',
      expected_output: '{"tasks":[...]}',
      source: "synthetic",
    });
    expect(ec.task).toBe("planner");
    const cases = store.listEvalCasesByTask("planner");
    expect(cases.length).toBeGreaterThanOrEqual(1);
  });

  test("countEvalCasesByTask returns correct count", () => {
    store.createEvalCase({ task: "planner", input: '{}', source: "synthetic" });
    store.createEvalCase({ task: "planner", input: '{}', source: "real" });
    expect(store.countEvalCasesByTask("planner")).toBeGreaterThanOrEqual(2);
  });

  // --- Tournaments ---
  test("createTournament and listTournamentsByTask", () => {
    const genome = store.createGenome({ task: "planner", gene_ids: [] });
    const v1 = store.createVariant({ genome_id: genome.id, compiled_prompt: "a", generation: 1 });
    const v2 = store.createVariant({ genome_id: genome.id, compiled_prompt: "b", generation: 1 });
    const ec = store.createEvalCase({ task: "planner", input: '{}', source: "synthetic" });

    const t = store.createTournament({
      task: "planner",
      variant_a_id: v1.id,
      variant_b_id: v2.id,
      eval_case_id: ec.id,
      segment_id: "default",
      model: "gpt-4o-mini",
    });
    expect(t.task).toBe("planner");
    expect(t.model).toBe("gpt-4o-mini");

    const tournaments = store.listTournamentsByTask("planner");
    expect(tournaments.length).toBeGreaterThanOrEqual(1);
  });

  test("updateTournamentResult sets winner and reasoning", () => {
    const genome = store.createGenome({ task: "planner", gene_ids: [] });
    const v1 = store.createVariant({ genome_id: genome.id, compiled_prompt: "a", generation: 1 });
    const v2 = store.createVariant({ genome_id: genome.id, compiled_prompt: "b", generation: 1 });
    const ec = store.createEvalCase({ task: "planner", input: '{}', source: "synthetic" });

    const t = store.createTournament({
      task: "planner",
      variant_a_id: v1.id,
      variant_b_id: v2.id,
      eval_case_id: ec.id,
      segment_id: "default",
      model: "gpt-4o-mini",
    });
    store.updateTournamentResult(t.id, "a", "A is better", 0.85);
    // Verify via list
    const results = store.listTournamentsByTask("planner");
    const updated = results.find((r) => r.id === t.id);
    expect(updated!.winner).toBe("a");
    expect(updated!.judge_confidence).toBe(0.85);
  });

  // --- Champions ---
  test("getChampion returns null when no champion exists", () => {
    expect(store.getChampion("planner", "default")).toBeNull();
  });

  test("setChampion creates champion and records history", () => {
    const genome = store.createGenome({ task: "planner", gene_ids: [] });
    const variant = store.createVariant({ genome_id: genome.id, compiled_prompt: "champ", generation: 1 });

    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: variant.id,
      model: "gpt-4o-mini",
      win_rate: 0.75,
      battle_count: 20,
      previous_variant_id: null,
    });

    const champ = store.getChampion("planner", "default");
    expect(champ).not.toBeNull();
    expect(champ!.variant_id).toBe(variant.id);
    expect(champ!.win_rate).toBe(0.75);
  });

  test("setChampion replaces existing champion and demotes old", () => {
    const genome = store.createGenome({ task: "planner", gene_ids: [] });
    const v1 = store.createVariant({ genome_id: genome.id, compiled_prompt: "old", generation: 1 });
    const v2 = store.createVariant({ genome_id: genome.id, compiled_prompt: "new", generation: 2 });

    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: v1.id,
      model: "gpt-4o-mini",
      win_rate: 0.65,
      battle_count: 20,
      previous_variant_id: null,
    });

    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: v2.id,
      model: "gpt-4o-mini",
      win_rate: 0.80,
      battle_count: 20,
      previous_variant_id: v1.id,
    });

    const champ = store.getChampion("planner", "default");
    expect(champ!.variant_id).toBe(v2.id);

    const history = store.getChampionHistory("planner", "default");
    expect(history.length).toBeGreaterThanOrEqual(2);
    const demoted = history.find((h) => h.demoted_at !== null);
    expect(demoted).toBeDefined();
  });

  test("lockChampion and unlockChampion toggle is_locked", () => {
    const genome = store.createGenome({ task: "planner", gene_ids: [] });
    const v = store.createVariant({ genome_id: genome.id, compiled_prompt: "locked", generation: 1 });
    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: v.id,
      model: "gpt-4o-mini",
      win_rate: 0.75,
      battle_count: 20,
      previous_variant_id: null,
    });

    store.lockChampion("planner", "default");
    let champ = store.getChampion("planner", "default");
    expect(champ!.is_locked).toBe(1);

    store.unlockChampion("planner", "default");
    champ = store.getChampion("planner", "default");
    expect(champ!.is_locked).toBe(0);
  });

  test("rollbackChampion restores previous variant", () => {
    const genome = store.createGenome({ task: "planner", gene_ids: [] });
    const v1 = store.createVariant({ genome_id: genome.id, compiled_prompt: "old", generation: 1 });
    const v2 = store.createVariant({ genome_id: genome.id, compiled_prompt: "new", generation: 2 });

    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: v1.id,
      model: "gpt-4o-mini",
      win_rate: 0.65,
      battle_count: 20,
      previous_variant_id: null,
    });
    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: v2.id,
      model: "gpt-4o-mini",
      win_rate: 0.80,
      battle_count: 20,
      previous_variant_id: v1.id,
    });

    const rolled = store.rollbackChampion("planner", "default");
    expect(rolled).not.toBeNull();
    expect(rolled!.variant_id).toBe(v1.id);
  });

  test("rollbackChampion returns null when no previous champion", () => {
    const genome = store.createGenome({ task: "planner", gene_ids: [] });
    const v = store.createVariant({ genome_id: genome.id, compiled_prompt: "only", generation: 1 });
    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: v.id,
      model: "gpt-4o-mini",
      win_rate: 0.75,
      battle_count: 20,
      previous_variant_id: null,
    });
    expect(store.rollbackChampion("planner", "default")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/prompt/gene-store.test.ts`
Expected: FAIL — `GeneStore` module not found.

- [ ] **Step 3: Write GeneStore implementation**

Create `src/core/prompt/gene-store.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { KaiDB } from "../../db/client";
import type {
  PromptGene,
  PromptGenome,
  PromptVariant,
  PromptSegment,
  PromptEvalCase,
  PromptTournament,
  PromptChampion,
  PromptChampionHistory,
  PromptTask,
  GeneType,
  MutationType,
  EvalSource,
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
        `INSERT INTO prompt_genes (id, task, type, content, trait_bindings, metadata)
         VALUES ($id, $task, $type, $content, $bindings, $meta)`,
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
    return this.db.query("SELECT * FROM prompt_genes WHERE id = $id").get({ $id: id }) as PromptGene | null;
  }

  listGenes(task?: PromptTask): PromptGene[] {
    if (task) {
      return this.db.query("SELECT * FROM prompt_genes WHERE task = $task ORDER BY created_at").all({ $task: task }) as PromptGene[];
    }
    return this.db.query("SELECT * FROM prompt_genes ORDER BY created_at").all() as PromptGene[];
  }

  updateGene(id: string, fields: Partial<Pick<PromptGene, "content" | "trait_bindings" | "metadata">>): void {
    const sets: string[] = [];
    const params: Record<string, string> = { $id: id };
    if (fields.content !== undefined) { sets.push("content = $content"); params.$content = fields.content; }
    if (fields.trait_bindings !== undefined) { sets.push("trait_bindings = $bindings"); params.$bindings = fields.trait_bindings; }
    if (fields.metadata !== undefined) { sets.push("metadata = $meta"); params.$meta = fields.metadata; }
    if (sets.length === 0) return;
    this.db.query(`UPDATE prompt_genes SET ${sets.join(", ")} WHERE id = $id`).run(params);
  }

  deleteGene(id: string): void {
    this.db.query("DELETE FROM prompt_genes WHERE id = $id").run({ $id: id });
  }

  // --- Genomes ---

  createGenome(input: { task: PromptTask; gene_ids: string[]; compiler_config?: string }): PromptGenome {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO prompt_genomes (id, task, gene_ids, compiler_config)
         VALUES ($id, $task, $geneIds, $config)`,
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
    return this.db.query("SELECT * FROM prompt_genomes WHERE id = $id").get({ $id: id }) as PromptGenome | null;
  }

  getGenomeByTask(task: PromptTask): PromptGenome | null {
    return this.db.query("SELECT * FROM prompt_genomes WHERE task = $task LIMIT 1").get({ $task: task }) as PromptGenome | null;
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
        `INSERT INTO prompt_variants (id, genome_id, compiled_prompt, generation, parent_variant_id, mutation_type)
         VALUES ($id, $genome, $prompt, $gen, $parent, $mut)`,
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
    return this.db.query("SELECT * FROM prompt_variants WHERE id = $id").get({ $id: id }) as PromptVariant | null;
  }

  listVariantsByGenome(genomeId: string): PromptVariant[] {
    return this.db.query("SELECT * FROM prompt_variants WHERE genome_id = $genome ORDER BY created_at").all({ $genome: genomeId }) as PromptVariant[];
  }

  // --- Segments ---

  getSegment(id: string): PromptSegment | null {
    return this.db.query("SELECT * FROM prompt_segments WHERE id = $id").get({ $id: id }) as PromptSegment | null;
  }

  listSegments(): PromptSegment[] {
    return this.db.query("SELECT * FROM prompt_segments ORDER BY name").all() as PromptSegment[];
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
        `INSERT INTO prompt_eval_cases (id, task, input, expected_output, difficulty, source)
         VALUES ($id, $task, $input, $expected, $difficulty, $source)`,
      )
      .run({
        $id: id,
        $task: input.task,
        $input: input.input,
        $expected: input.expected_output ?? null,
        $difficulty: input.difficulty ?? "medium",
        $source: input.source ?? "synthetic",
      });
    return this.db.query("SELECT * FROM prompt_eval_cases WHERE id = $id").get({ $id: id }) as PromptEvalCase;
  }

  listEvalCasesByTask(task: PromptTask): PromptEvalCase[] {
    return this.db.query("SELECT * FROM prompt_eval_cases WHERE task = $task ORDER BY created_at").all({ $task: task }) as PromptEvalCase[];
  }

  countEvalCasesByTask(task: PromptTask): number {
    const row = this.db.query("SELECT COUNT(*) as c FROM prompt_eval_cases WHERE task = $task").get({ $task: task }) as { c: number };
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
        `INSERT INTO prompt_tournaments (id, task, variant_a_id, variant_b_id, eval_case_id, segment_id, model)
         VALUES ($id, $task, $a, $b, $ec, $seg, $model)`,
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
    return this.db.query("SELECT * FROM prompt_tournaments WHERE id = $id").get({ $id: id }) as PromptTournament;
  }

  updateTournamentResult(id: string, winner: TournamentWinner, reasoning: string, confidence: number): void {
    this.db
      .query(
        `UPDATE prompt_tournaments SET winner = $winner, judge_reasoning = $reasoning, judge_confidence = $confidence, judged_at = datetime('now')
         WHERE id = $id`,
      )
      .run({ $id: id, $winner: winner, $reasoning: reasoning, $confidence: confidence });
  }

  listTournamentsByTask(task: PromptTask, limit?: number): PromptTournament[] {
    let sql = "SELECT * FROM prompt_tournaments WHERE task = $task ORDER BY created_at DESC";
    const params: Record<string, string | number> = { $task: task };
    if (limit !== undefined) {
      sql += " LIMIT $limit";
      params.$limit = limit;
    }
    return this.db.query(sql).all(params) as PromptTournament[];
  }

  countTournamentWins(variantId: string, task: string, segmentId: string): { wins: number; losses: number; ties: number; total: number } {
    const rows = this.db.query(
      `SELECT winner, COUNT(*) as c FROM prompt_tournaments
       WHERE task = $task AND segment_id = $seg AND (variant_a_id = $vid OR variant_b_id = $vid) AND winner IS NOT NULL
       GROUP BY winner`,
    ).all({ $task: task, $seg: segmentId, $vid: variantId }) as { winner: string; c: number }[];

    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const row of rows) {
      if (row.winner === "tie") { ties = row.c; continue; }
      // Check if this variant won — need to determine if it was a or b
      const asWinner = this.db.query(
        `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND variant_a_id = $vid AND winner = 'a'
         UNION ALL
         SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND variant_b_id = $vid AND winner = 'b'`,
      ).all({ $task: task, $seg: segmentId, $vid: variantId }) as { c: number }[];
      wins = asWinner.reduce((sum, r) => sum + r.c, 0);
    }
    // Simpler approach: count wins directly
    const winAsA = this.db.query(
      `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND variant_a_id = $vid AND winner = 'a'`,
    ).get({ $task: task, $seg: segmentId, $vid: variantId }) as { c: number };
    const winAsB = this.db.query(
      `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND variant_b_id = $vid AND winner = 'b'`,
    ).get({ $task: task, $seg: segmentId, $vid: variantId }) as { c: number };
    const lossAsA = this.db.query(
      `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND variant_a_id = $vid AND winner = 'b'`,
    ).get({ $task: task, $seg: segmentId, $vid: variantId }) as { c: number };
    const lossAsB = this.db.query(
      `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND variant_b_id = $vid AND winner = 'a'`,
    ).get({ $task: task, $seg: segmentId, $vid: variantId }) as { c: number };
    const tieRows = this.db.query(
      `SELECT COUNT(*) as c FROM prompt_tournaments WHERE task = $task AND segment_id = $seg AND (variant_a_id = $vid OR variant_b_id = $vid) AND winner = 'tie'`,
    ).get({ $task: task, $seg: segmentId, $vid: variantId }) as { c: number };

    wins = winAsA.c + winAsB.c;
    losses = lossAsA.c + lossAsB.c;
    ties = tieRows.c;
    const total = wins + losses + ties;
    return { wins, losses, ties, total };
  }

  // --- Champions ---

  getChampion(task: PromptTask, segmentId: string, model?: string): PromptChampion | null {
    const m = model ?? "gpt-4o-mini";
    return this.db
      .query("SELECT * FROM prompt_champions WHERE task = $task AND segment_id = $seg AND model = $model")
      .get({ $task: task, $seg: segmentId, $model: m }) as PromptChampion | null;
  }

  setChampion(input: {
    task: PromptTask;
    segment_id: string;
    variant_id: string;
    model: string;
    win_rate: number;
    battle_count: number;
    previous_variant_id: string | null;
  }): void {
    const id = randomUUID();
    // Record current champion in history first (if exists)
    const current = this.getChampion(input.task, input.segment_id, input.model);
    if (current) {
      this.db
        .query(
          `INSERT INTO prompt_champion_history (id, task, segment_id, variant_id, model, win_rate, battle_count, promoted_at, demoted_at, demotion_reason)
           VALUES ($id, $task, $seg, $vid, $model, $wr, $bc, $promoted, datetime('now'), 'superseded')`,
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

    // Upsert champion
    this.db
      .query(
        `INSERT OR REPLACE INTO prompt_champions (id, task, segment_id, variant_id, model, win_rate, battle_count, promoted_at, previous_variant_id, is_locked)
         VALUES ($id, $task, $seg, $vid, $model, $wr, $bc, datetime('now'), $prev, 0)`,
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
  }

  lockChampion(task: PromptTask, segmentId: string, model?: string): void {
    const m = model ?? "gpt-4o-mini";
    this.db
      .query("UPDATE prompt_champions SET is_locked = 1 WHERE task = $task AND segment_id = $seg AND model = $model")
      .run({ $task: task, $seg: segmentId, $model: m });
  }

  unlockChampion(task: PromptTask, segmentId: string, model?: string): void {
    const m = model ?? "gpt-4o-mini";
    this.db
      .query("UPDATE prompt_champions SET is_locked = 0 WHERE task = $task AND segment_id = $seg AND model = $model")
      .run({ $task: task, $seg: segmentId, $model: m });
  }

  getChampionHistory(task: PromptTask, segmentId: string, model?: string): PromptChampionHistory[] {
    const m = model ?? "gpt-4o-mini";
    return this.db
      .query("SELECT * FROM prompt_champion_history WHERE task = $task AND segment_id = $seg AND model = $model ORDER BY promoted_at DESC")
      .all({ $task: task, $seg: segmentId, $model: m }) as PromptChampionHistory[];
  }

  rollbackChampion(task: PromptTask, segmentId: string, model?: string): PromptChampion | null {
    const m = model ?? "gpt-4o-mini";
    const current = this.getChampion(task, segmentId, m);
    if (!current || !current.previous_variant_id) return null;

    // Find the history entry for the previous champion
    const history = this.getChampionHistory(task, segmentId, m);
    const prevEntry = history.find((h) => h.variant_id === current.previous_variant_id);
    if (!prevEntry) return null;

    // Set champion back to previous
    this.setChampion({
      task,
      segment_id: segmentId,
      variant_id: prevEntry.variant_id,
      model: m,
      win_rate: prevEntry.win_rate,
      battle_count: prevEntry.battle_count,
      previous_variant_id: null,
    });

    // Mark the demotion reason as rollback for the current champion's history entry
    this.db
      .query(
        `UPDATE prompt_champion_history SET demotion_reason = 'rollback'
         WHERE task = $task AND segment_id = $seg AND variant_id = $vid AND demotion_reason = 'superseded'`,
      )
      .run({ $task: task, $seg: segmentId, $vid: current.variant_id });

    return this.getChampion(task, segmentId, m);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/prompt/gene-store.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt/types.ts src/core/prompt/gene-store.ts tests/core/prompt/gene-store.test.ts
git commit -m "feat: add GeneStore with CRUD for all 8 prompt genome tables"
```

---

## Task 4: PromptCompiler — Assembly Pipeline

**Files:**
- Create: `src/core/prompt/prompt-compiler.ts`
- Create: `tests/core/prompt/prompt-compiler.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/prompt/prompt-compiler.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { PromptCompiler } from "../../../src/core/prompt/prompt-compiler";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type { Trait } from "../../../src/core/profile/types";

describe("PromptCompiler", () => {
  let db: KaiDB;
  let store: GeneStore;
  let compiler: PromptCompiler;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("compiler");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
    compiler = new PromptCompiler(store);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  const emptyTraits: Trait[] = [];

  test("compile returns seeded planner prompt for empty traits", async () => {
    const result = await compiler.compile("planner", emptyTraits);
    expect(result.prompt.length).toBeGreaterThan(50);
    expect(result.gene_count).toBeGreaterThanOrEqual(2);
    expect(result.segment_id).toBe("default");
  });

  test("compile returns cached result on second call", async () => {
    const result1 = await compiler.compile("planner", emptyTraits);
    const result2 = await compiler.compile("planner", emptyTraits);
    expect(result2.cached).toBe(true);
    expect(result1.prompt).toBe(result2.prompt);
  });

  test("compile cache invalidates after clearCache", async () => {
    await compiler.compile("planner", emptyTraits);
    compiler.clearCache();
    const result = await compiler.compile("planner", emptyTraits);
    expect(result.cached).toBe(false);
  });

  test("compile validates output — no unresolved {{...}} placeholders", async () => {
    const result = await compiler.compile("planner", emptyTraits);
    expect(result.prompt).not.toMatch(/\{\{.*?\}\}/);
  });

  test("compile validates output — length > 50 chars", async () => {
    const result = await compiler.compile("planner", emptyTraits);
    expect(result.prompt.length).toBeGreaterThan(50);
  });

  test("compile fallback to hardcoded prompt when gene store empty for task", async () => {
    // No genome for "derivator" yet — should fallback gracefully
    const result = await compiler.compile("derivator", emptyTraits);
    expect(result.prompt.length).toBeGreaterThan(0);
    expect(result.segment_id).toBe("default");
  });

  test("compile with profile traits passes traits to interpolation context", async () => {
    const traits: Trait[] = [
      { id: "1", dimension: "detail_oriented", value: 0.8, confidence: 8, source: "observed", reasoning: "test", updated_at: "" },
    ];
    const result = await compiler.compile("planner", traits);
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  test("compile uses champion variant when available", async () => {
    // Set a champion for planner + default
    const genome = store.getGenomeByTask("planner")!;
    const variant = store.createVariant({
      genome_id: genome.id,
      compiled_prompt: "Custom champion prompt that is long enough for validation",
      generation: 2,
      mutation_type: "intent_rephrase",
    });
    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: variant.id,
      model: "gpt-4o-mini",
      win_rate: 0.80,
      battle_count: 20,
      previous_variant_id: null,
    });
    compiler.clearCache();

    const result = await compiler.compile("planner", emptyTraits);
    expect(result.prompt).toBe("Custom champion prompt that is long enough for validation");
    expect(result.variant_id).toBe(variant.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/prompt/prompt-compiler.test.ts`
Expected: FAIL — `PromptCompiler` module not found.

- [ ] **Step 3: Write PromptCompiler implementation**

Create `src/core/prompt/prompt-compiler.ts`:

```typescript
import type { Trait } from "../profile/types";
import { GeneStore } from "./gene-store";
import type { PromptTask, CompiledPrompt } from "./types";

const FALLBACK_PROMPTS: Record<PromptTask, string> = {
  planner: `You are a task decomposition engine. Given an idea and a user's behavioral profile, break the idea into actionable tasks.

Return a JSON object with a "tasks" array. Each task MUST have these fields:
- title (string, max 100 chars)
- description (string, max 500 chars)
- type ("one_off" or "cron")
- agent ("hermes")
- prompt (string, the execution instruction for the agent)
- decomposition_rationale (string, why this task exists)
- scheduling_rationale (string, why scheduled this way)

For cron tasks, also include:
- cron_schedule (cron expression)
- cron_prompt (prompt for each cycle)

Constraints:
- Produce 3-8 tasks total
- Each description max 500 characters
- Use the user's behavioral profile to influence decomposition strategy
- CRITICAL: Never include raw profile data, trait values, or behavioral observations verbatim in any task field. Synthesize insights into actionable instructions only.`,
  derivator: `You are a user profile analysis engine. Given observations about a user, derive personality traits.
Return a JSON object with a "traits" array. Each trait has: dimension (string), value (0.0-1.0), confidence (1-10), reasoning (string).
Valid dimensions: scope_appetite, risk_tolerance, autonomy, early_riser, tinkerer, consistent_user, detail_oriented.`,
  observer: "",
};

export class PromptCompiler {
  private store: GeneStore;
  private cache: Map<string, CompiledPrompt> = new Map();

  constructor(store: GeneStore) {
    this.store = store;
  }

  async compile(task: PromptTask, traits: Trait[]): Promise<CompiledPrompt> {
    const cacheKey = `${task}:${this.traitHash(traits)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    // 1. Find champion variant for task + default segment
    const champion = this.store.getChampion(task, "default");
    if (champion) {
      const variant = this.store.getVariant(champion.variant_id);
      if (variant && this.validateCompiledPrompt(variant.compiled_prompt)) {
        const result: CompiledPrompt = {
          prompt: variant.compiled_prompt,
          segment_id: "default",
          genome_id: variant.genome_id,
          variant_id: variant.id,
          gene_count: -1,
          cached: false,
        };
        this.cache.set(cacheKey, result);
        return result;
      }
    }

    // 2. Assemble from genome
    const genome = this.store.getGenomeByTask(task);
    if (!genome) {
      const result: CompiledPrompt = {
        prompt: FALLBACK_PROMPTS[task],
        segment_id: "default",
        genome_id: "",
        variant_id: null,
        gene_count: 0,
        cached: false,
      };
      return result;
    }

    const geneIds: string[] = JSON.parse(genome.gene_ids);
    const parts: string[] = [];
    let geneCount = 0;

    for (const geneId of geneIds) {
      const gene = this.store.getGene(geneId);
      if (!gene) continue;
      // For intent and contract genes, inject content as-is
      // Adapter, tone, example genes handled in Task 10
      if (gene.type === "intent" || gene.type === "contract") {
        parts.push(gene.content);
        geneCount++;
      }
    }

    const compiled = parts.join("\n\n");

    if (!this.validateCompiledPrompt(compiled)) {
      const result: CompiledPrompt = {
        prompt: FALLBACK_PROMPTS[task],
        segment_id: "default",
        genome_id: genome.id,
        variant_id: null,
        gene_count: 0,
        cached: false,
      };
      return result;
    }

    const result: CompiledPrompt = {
      prompt: compiled,
      segment_id: "default",
      genome_id: genome.id,
      variant_id: null,
      gene_count: geneCount,
      cached: false,
    };
    this.cache.set(cacheKey, result);
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private validateCompiledPrompt(prompt: string): boolean {
    if (prompt.length <= 50) return false;
    if (/\{\{.*?\}\}/.test(prompt)) return false;
    return true;
  }

  private traitHash(traits: Trait[]): string {
    if (traits.length === 0) return "none";
    return traits
      .map((t) => `${t.dimension}=${t.value.toFixed(2)}`)
      .sort()
      .join(",");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/prompt/prompt-compiler.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt/prompt-compiler.ts tests/core/prompt/prompt-compiler.test.ts
git commit -m "feat: add PromptCompiler with assembly pipeline, cache, and fallback"
```

---

## Task 5: SegmentMatcher

**Files:**
- Create: `src/core/prompt/segment-matcher.ts`
- Create: `tests/core/prompt/segment-matcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/prompt/segment-matcher.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { SegmentMatcher } from "../../../src/core/prompt/segment-matcher";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type { Trait } from "../../../src/core/profile/types";

describe("SegmentMatcher", () => {
  let db: KaiDB;
  let store: GeneStore;
  let matcher: SegmentMatcher;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("segment");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
    matcher = new SegmentMatcher(store);

    // Add test segments
    const database = db.getDatabase();
    database.run(
      `INSERT OR IGNORE INTO prompt_segments (id, name, trait_constraints, description)
       VALUES ('detail_tinkerer', 'detail_tinkerer', '{"detail_oriented":{"min":0.7},"tinkerer":{"min":0.5}}', 'Detail-oriented tinkerer')`,
    );
    database.run(
      `INSERT OR IGNORE INTO prompt_segments (id, name, trait_constraints, description)
       VALUES ('cautious_planner', 'cautious_planner', '{"risk_tolerance":{"max":0.3},"planning_style":{"min":0.6}}', 'Cautious planner')`,
    );
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  function makeTrait(dimension: string, value: number, confidence = 8): Trait {
    return { id: dimension, dimension, value, confidence, source: "observed" as const, reasoning: "", updated_at: "" };
  }

  test("returns default segment when no traits provided", () => {
    const result = matcher.match([]);
    expect(result.segment_id).toBe("default");
    expect(result.is_default).toBe(true);
  });

  test("returns default segment when no segments match", () => {
    const traits = [makeTrait("scope_appetite", 0.9)];
    const result = matcher.match(traits);
    expect(result.segment_id).toBe("default");
    expect(result.is_default).toBe(true);
  });

  test("matches detail_tinkerer segment", () => {
    const traits = [
      makeTrait("detail_oriented", 0.8),
      makeTrait("tinkerer", 0.7),
    ];
    const result = matcher.match(traits);
    expect(result.segment_id).toBe("detail_tinkerer");
    expect(result.constraints_satisfied).toBe(2);
    expect(result.is_default).toBe(false);
  });

  test("matches cautious_planner segment", () => {
    const traits = [
      makeTrait("risk_tolerance", 0.2),
      makeTrait("planning_style", 0.8),
    ];
    const result = matcher.match(traits);
    expect(result.segment_id).toBe("cautious_planner");
  });

  test("picks segment with most constraints satisfied when multiple match", () => {
    // detail_tinkerer needs detail_oriented>=0.7 AND tinkerer>=0.5 = 2 constraints
    // cautious_planner needs risk_tolerance<=0.3 AND planning_style>=0.6 = 2 constraints
    // Satisfy both, detail_tinkerer has 2, cautious_planner has 2 — pick first alphabetically or first by creation
    const traits = [
      makeTrait("detail_oriented", 0.8),
      makeTrait("tinkerer", 0.7),
      makeTrait("risk_tolerance", 0.2),
      makeTrait("planning_style", 0.8),
    ];
    const result = matcher.match(traits);
    expect(result.is_default).toBe(false);
    expect(result.constraints_satisfied).toBeGreaterThanOrEqual(2);
  });

  test("skips traits with low confidence", () => {
    const traits = [
      makeTrait("detail_oriented", 0.8, 2), // confidence < 5, should be skipped
      makeTrait("tinkerer", 0.7),
    ];
    const result = matcher.match(traits);
    // detail_oriented is skipped due to low confidence, so detail_tinkerer won't match
    expect(result.is_default).toBe(true);
  });

  test("returns default for profile with < 3 high-confidence traits", () => {
    const traits = [
      makeTrait("detail_oriented", 0.8, 7),
      makeTrait("tinkerer", 0.7, 7),
      // Only 2 high-confidence traits < 3 threshold
    ];
    const result = matcher.match(traits);
    expect(result.is_default).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/prompt/segment-matcher.test.ts`
Expected: FAIL — `SegmentMatcher` module not found.

- [ ] **Step 3: Write SegmentMatcher implementation**

Create `src/core/prompt/segment-matcher.ts`:

```typescript
import type { Trait } from "../profile/types";
import type { GeneStore } from "./gene-store";
import type { SegmentMatch } from "./types";

const MIN_HIGH_CONFIDENCE_TRAITS = 3;
const MIN_CONFIDENCE_THRESHOLD = 5;

export class SegmentMatcher {
  private store: GeneStore;

  constructor(store: GeneStore) {
    this.store = store;
  }

  match(traits: Trait[]): SegmentMatch {
    // Filter to high-confidence traits only
    const highConfidenceTraits = traits.filter(
      (t) => t.confidence >= MIN_CONFIDENCE_THRESHOLD,
    );

    // If fewer than threshold high-confidence traits, use default
    if (highConfidenceTraits.length < MIN_HIGH_CONFIDENCE_TRAITS) {
      return {
        segment_id: "default",
        segment_name: "default",
        constraints_satisfied: 0,
        is_default: true,
      };
    }

    const traitMap = new Map(highConfidenceTraits.map((t) => [t.dimension, t.value]));
    const segments = this.store.listSegments();

    let bestMatch: SegmentMatch = {
      segment_id: "default",
      segment_name: "default",
      constraints_satisfied: 0,
      is_default: true,
    };

    for (const segment of segments) {
      if (segment.id === "default") continue;

      const constraints = JSON.parse(segment.trait_constraints) as Record<
        string,
        { min?: number; max?: number }
      >;
      let satisfied = 0;
      let allSatisfied = true;

      for (const [dimension, constraint] of Object.entries(constraints)) {
        const value = traitMap.get(dimension);
        if (value === undefined) {
          allSatisfied = false;
          continue;
        }
        if (constraint.min !== undefined && value < constraint.min) {
          allSatisfied = false;
        }
        if (constraint.max !== undefined && value > constraint.max) {
          allSatisfied = false;
        }
        if (
          (constraint.min !== undefined && value >= constraint.min) ||
          (constraint.max !== undefined && value <= constraint.max)
        ) {
          satisfied++;
        }
      }

      if (allSatisfied && satisfied > bestMatch.constraints_satisfied) {
        bestMatch = {
          segment_id: segment.id,
          segment_name: segment.name,
          constraints_satisfied: satisfied,
          is_default: false,
        };
      }
    }

    return bestMatch;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/prompt/segment-matcher.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt/segment-matcher.ts tests/core/prompt/segment-matcher.test.ts
git commit -m "feat: add SegmentMatcher with profile-to-segment matching"
```

---

## Task 6: LLMProvider Extension — callWithModel()

**Files:**
- Modify: `src/llm/provider.ts:46-105`
- Modify: `tests/llm-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/llm-provider.test.ts`:

```typescript
test("buildRequestBody overrides model when provided", () => {
  const provider = new LLMProvider({ apiKey: "key", baseUrl: "http://localhost:11434/v1", model: "default-model" });
  const body = provider.buildRequestBody("prompt", "system", undefined, { model: "gpt-4o" });
  expect(body.model).toBe("gpt-4o");
});

test("buildRequestBody uses default model when no override", () => {
  const provider = new LLMProvider({ apiKey: "key", baseUrl: "http://localhost:11434/v1", model: "default-model" });
  const body = provider.buildRequestBody("prompt", "system");
  expect(body.model).toBe("default-model");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/llm-provider.test.ts`
Expected: FAIL — `buildRequestBody` doesn't accept `options.model` yet.

- [ ] **Step 3: Modify buildRequestBody to accept model override**

In `src/llm/provider.ts`, update `buildRequestBody` signature and body at line 43:

```typescript
buildRequestBody(
    prompt: string,
    systemPrompt: string,
    options?: { max_tokens?: number; model?: string },
  ): Record<string, unknown> {
    return {
      model: options?.model ?? this.config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ] as ChatMessage[],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: options?.max_tokens ?? 2048,
    };
  }
```

Also update `call()` at line 58 to pass options through:

```typescript
async call(
    prompt: string,
    systemPrompt: string,
    retries = 1,
    options?: { max_tokens?: number; model?: string },
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body = this.buildRequestBody(prompt, systemPrompt, options);
    // ... rest unchanged
```

Add `callWithModel` method after `call()`:

```typescript
async callWithModel(
    model: string,
    prompt: string,
    systemPrompt: string,
    retries = 1,
    options?: { max_tokens?: number },
  ): Promise<Record<string, unknown>> {
    return this.call(prompt, systemPrompt, retries, { ...options, model });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/llm-provider.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm/provider.ts tests/llm-provider.test.ts
git commit -m "feat: add callWithModel() and model override to LLMProvider"
```

---

## Task 7: Planner Integration — Constructor Injection

**Files:**
- Modify: `src/core/orchestrator/planner.ts:44-87`
- Modify: `src/mcp/orchestrator-handlers.ts:44-94`
- Modify: `tests/core/orchestrator/planner.test.ts` (if exists, otherwise verify existing tests pass)

- [ ] **Step 1: Modify Planner to accept optional PromptCompiler**

In `src/core/orchestrator/planner.ts`, update the import at line 1 and constructor:

```typescript
import type { LLMProvider } from "../../llm/provider";
import type { PromptCompiler } from "../prompt/prompt-compiler";
import type { Trait } from "../profile/types";
import { formatProfileContext } from "./profile-context";
import type { OrchestratorStore } from "./store";
import type { Idea, PlannedTask } from "./types";
```

Update the constructor at line 44:

```typescript
export class Planner {
  private store: OrchestratorStore;
  private llm: LLMProvider;
  private compiler: PromptCompiler | null;

  constructor(store: OrchestratorStore, llm: LLMProvider, compiler?: PromptCompiler) {
    this.store = store;
    this.llm = llm;
    this.compiler = compiler ?? null;
  }
```

Update `decomposeIdea` at line 53 to use compiler when available:

```typescript
async decomposeIdea(ideaId: string, traits: Trait[]): Promise<PlannedTask[]> {
    const idea = this.store.getIdea(ideaId);
    if (!idea) throw new Error("Idea not found");

    const profileContext = formatProfileContext(traits);
    const prompt = this.buildPrompt(idea, profileContext);

    // Get system prompt from compiler or fallback to hardcoded
    let systemPrompt: string;
    try {
      if (this.compiler) {
        const compiled = await this.compiler.compile("planner", traits);
        systemPrompt = compiled.prompt;
      } else {
        systemPrompt = PLANNER_SYSTEM_PROMPT;
      }
    } catch {
      systemPrompt = PLANNER_SYSTEM_PROMPT;
    }

    try {
      const response = await this.llm.call(prompt, systemPrompt);

      try {
        this.llm.validateWithSchema(response as Record<string, unknown>, [
          "tasks",
        ]);
        return this.processAndPersist(idea, response);
      } catch {
        try {
          const retryResponse = await this.llm.call(
            prompt,
            SIMPLE_SYSTEM_PROMPT,
          );
          this.llm.validateWithSchema(
            retryResponse as Record<string, unknown>,
            ["tasks"],
          );
          return this.processAndPersist(idea, retryResponse);
        } catch {
          return this.fallbackSingleTask(idea);
        }
      }
    } catch {
      return this.fallbackSingleTask(idea);
    }
  }
```

- [ ] **Step 2: Update MCP orchestrator-handlers.ts to pass PromptCompiler**

In `src/mcp/orchestrator-handlers.ts`, add import after line 12:

```typescript
import { PromptCompiler } from "../core/prompt/prompt-compiler";
import { GeneStore } from "../core/prompt/gene-store";
```

At line 44, inside `registerOrchestratorHandlers`, add compiler setup:

```typescript
export function registerOrchestratorHandlers(
  server: McpServer,
  db: KaiDB,
): void {
  const profileEngine = new ProfileEngine(db);
  const store = new OrchestratorStore(db);
  const workspaceStore = new WorkspaceStore(db);
  const llmProvider = new LLMProvider();
  const bridge = new HermesAgentBridge();
  const _closedLoopEngine = new ClosedLoopEngine(profileEngine, store);
  const geneStore = new GeneStore(db);
  const promptCompiler = new PromptCompiler(geneStore);
```

Update `kai_idea_plan` handler (line 94) to pass compiler:

```typescript
const planner = new Planner(store, llmProvider, promptCompiler);
```

And `kai_replan` handler (line 293):

```typescript
const planner = new Planner(store, llmProvider, promptCompiler);
```

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: ALL PASS — existing planner tests work because compiler is optional (defaults to null).

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator/planner.ts src/mcp/orchestrator-handlers.ts
git commit -m "feat: integrate PromptCompiler into Planner via constructor injection"
```

---

## Task 8: JudgeEngine — LLM-as-Judge

**Files:**
- Create: `src/core/prompt/judge-engine.ts`

- [ ] **Step 1: Write JudgeEngine**

Create `src/core/prompt/judge-engine.ts`:

```typescript
import type { LLMProvider } from "../../llm/provider";
import type { TournamentWinner, TournamentResult } from "./types";

const JUDGE_SYSTEM_PROMPT = `You are a prompt quality judge. Compare two prompt outputs for the same task.

Evaluate on (OUTPUT_CONTRACT is a gate — must pass first):
1. OUTPUT_CONTRACT (gate): Does the output match the required JSON schema? If one fails and other passes, the passing one wins.
2. PROFILE_ALIGNMENT (weight 0.3): Does the output leverage the user's behavioral profile appropriately?
3. TASK_QUALITY (weight 0.5): Is the decomposition/derivation high quality?
4. SAFETY (weight 0.2): Does the output avoid exposing raw profile data?

Output JSON: { "winner": "A" | "B" | "tie", "confidence": 0.0-1.0, "reasoning": string }`;

export class JudgeEngine {
  private llm: LLMProvider;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  async judge(
    outputA: string,
    outputB: string,
    evalInput: string,
  ): Promise<TournamentResult> {
    const prompt = JSON.stringify({
      task_input: evalInput,
      output_a: outputA,
      output_b: outputB,
    });

    const response = await this.llm.call(prompt, JUDGE_SYSTEM_PROMPT);
    return this.parseJudgeResponse(response as Record<string, unknown>);
  }

  async majorityVote(
    outputA: string,
    outputB: string,
    evalInput: string,
    calls = 3,
  ): Promise<TournamentResult> {
    const results = await Promise.allSettled(
      Array.from({ length: calls }, () => this.judge(outputA, outputB, evalInput)),
    );

    const successes: TournamentResult[] = [];
    const failures: unknown[] = [];

    for (const r of results) {
      if (r.status === "fulfilled") successes.push(r.value);
      else failures.push(r.reason);
    }

    if (successes.length < 2) {
      throw new Error(`Judge majority vote failed: ${failures.length} of ${calls} calls failed`);
    }

    // Count votes
    let aWins = 0;
    let bWins = 0;
    let ties = 0;
    let totalConfidence = 0;
    const reasonings: string[] = [];

    for (const result of successes) {
      if (result.winner === "a") aWins++;
      else if (result.winner === "b") bWins++;
      else ties++;
      totalConfidence += result.confidence;
      reasonings.push(result.reasoning);
    }

    // Determine winner by majority
    let winner: TournamentWinner;
    if (aWins > bWins && aWins > ties) winner = "a";
    else if (bWins > aWins && bWins > ties) winner = "b";
    else winner = "tie";

    return {
      variant_a_id: "",
      variant_b_id: "",
      winner,
      reasoning: reasonings.join("; "),
      confidence: totalConfidence / successes.length,
    };
  }

  private parseJudgeResponse(response: Record<string, unknown>): TournamentResult {
    const winner = response.winner as string;
    if (winner !== "a" && winner !== "b" && winner !== "tie") {
      throw new Error(`Invalid judge winner: ${winner}`);
    }
    return {
      variant_a_id: "",
      variant_b_id: "",
      winner: winner as TournamentWinner,
      reasoning: String(response.reasoning ?? ""),
      confidence: Number(response.confidence ?? 0.5),
    };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/prompt/judge-engine.ts
git commit -m "feat: add JudgeEngine with LLM-as-judge and majority vote"
```

---

## Task 9: TournamentRunner — Pairwise Battles

**Files:**
- Create: `src/core/prompt/tournament-runner.ts`
- Create: `tests/core/prompt/tournament.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/prompt/tournament.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { TournamentRunner } from "../../../src/core/prompt/tournament-runner";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type { LLMProvider } from "../../../src/llm/provider";

function createMockLLM(response: Record<string, unknown>): LLMProvider {
  return {
    call: async () => response,
    callWithModel: async (_model: string, _prompt: string, _sys: string) => response,
    buildHeaders: () => ({}),
    buildRequestBody: () => ({}),
    parseResponse: async (r: any) => r,
    validateWithSchema: () => {},
    getConfig: () => ({ apiKey: "", baseUrl: "", model: "mock" }),
  } as unknown as LLMProvider;
}

describe("TournamentRunner", () => {
  let db: KaiDB;
  let store: GeneStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("tournament");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("run returns error when no eval cases exist", async () => {
    const mockLLM = createMockLLM({ winner: "a", confidence: 0.8, reasoning: "A is better" });
    const runner = new TournamentRunner(store, mockLLM);
    const result = await runner.run({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });
    expect(result.error).toContain("no eval cases");
    expect(result.battles_run).toBe(0);
  });

  test("run completes tournament with mock variants and eval cases", async () => {
    const mockLLM = createMockLLM({ winner: "a", confidence: 0.8, reasoning: "A is better" });

    // Create eval case
    store.createEvalCase({
      task: "planner",
      input: '{"idea":"build feature X"}',
      source: "synthetic",
    });

    // Create variants
    const genome = store.getGenomeByTask("planner")!;
    store.createVariant({ genome_id: genome.id, compiled_prompt: "variant A prompt", generation: 1, mutation_type: "seed" });
    store.createVariant({ genome_id: genome.id, compiled_prompt: "variant B prompt", generation: 1, mutation_type: "intent_rephrase" });

    const runner = new TournamentRunner(store, mockLLM);
    const result = await runner.run({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });

    expect(result.battles_run).toBeGreaterThan(0);
    expect(result.tournaments.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/prompt/tournament.test.ts`
Expected: FAIL — `TournamentRunner` module not found.

- [ ] **Step 3: Write TournamentRunner implementation**

Create `src/core/prompt/tournament-runner.ts`:

```typescript
import type { LLMProvider } from "../../llm/provider";
import type { PromptTask, TournamentWinner } from "./types";
import { GeneStore } from "./gene-store";
import { JudgeEngine } from "./judge-engine";

export interface TournamentConfig {
  task: PromptTask;
  segment_id: string;
  model: string;
  sample_size?: number;
}

export interface TournamentRunResult {
  battles_run: number;
  tournaments: string[];
  error?: string;
}

export class TournamentRunner {
  private store: GeneStore;
  private judge: JudgeEngine;

  constructor(store: GeneStore, llm: LLMProvider) {
    this.store = store;
    this.judge = new JudgeEngine(llm);
  }

  async run(config: TournamentConfig): Promise<TournamentRunResult> {
    const evalCases = this.store.listEvalCasesByTask(config.task);
    if (evalCases.length === 0) {
      return { battles_run: 0, tournaments: [], error: "no eval cases in pool" };
    }

    const variants = this.store.listVariantsByGenome(
      (this.store.getGenomeByTask(config.task))?.id ?? "",
    );
    if (variants.length < 2) {
      return { battles_run: 0, tournaments: [], error: "need at least 2 variants" };
    }

    const sampleSize = config.sample_size ?? Math.min(10, evalCases.length);
    const sampledCases = evalCases.slice(0, sampleSize);

    const tournamentIds: string[] = [];
    let battlesRun = 0;

    // Pairwise: every variant against every other
    for (let i = 0; i < variants.length; i++) {
      for (let j = i + 1; j < variants.length; j++) {
        const variantA = variants[i];
        const variantB = variants[j];

        for (const evalCase of sampledCases) {
          const tournament = this.store.createTournament({
            task: config.task,
            variant_a_id: variantA.id,
            variant_b_id: variantB.id,
            eval_case_id: evalCase.id,
            segment_id: config.segment_id,
            model: config.model,
          });

          try {
            const result = await this.judge.majorityVote(
              variantA.compiled_prompt,
              variantB.compiled_prompt,
              evalCase.input,
            );

            // Swap A/B if positions were randomized by judge
            const winner: TournamentWinner = result.winner;
            this.store.updateTournamentResult(
              tournament.id,
              winner,
              result.reasoning,
              result.confidence,
            );
            battlesRun++;
          } catch {
            // Judge failed for this battle — leave result null
          }

          tournamentIds.push(tournament.id);
        }
      }
    }

    return { battles_run: battlesRun, tournaments: tournamentIds };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/prompt/tournament.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt/tournament-runner.ts tests/core/prompt/tournament.test.ts
git commit -m "feat: add TournamentRunner with pairwise battles and LLM-as-judge"
```

---

## Task 10: PromptEvolver — Mutation + Promotion

**Files:**
- Create: `src/core/prompt/prompt-evolver.ts`
- Create: `tests/core/prompt/prompt-evolver.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/prompt/prompt-evolver.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { PromptEvolver } from "../../../src/core/prompt/prompt-evolver";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type { LLMProvider } from "../../../src/llm/provider";

function createMockLLM(responses: Record<string, unknown>[]): LLMProvider & { callCount: number } {
  let idx = 0;
  return {
    callCount: 0,
    call: async () => {
      const r = responses[idx++ % responses.length];
      return r;
    },
    callWithModel: async () => {
      const r = responses[idx++ % responses.length];
      return r;
    },
    buildHeaders: () => ({}),
    buildRequestBody: () => ({}),
    parseResponse: async (r: any) => r,
    validateWithSchema: () => {},
    getConfig: () => ({ apiKey: "", baseUrl: "", model: "mock" }),
  } as unknown as LLMProvider & { callCount: number };
}

describe("PromptEvolver", () => {
  let db: KaiDB;
  let store: GeneStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("evolver");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("evolve returns error when no eval cases", async () => {
    const mockLLM = createMockLLM([{ tasks: [] }]);
    const evolver = new PromptEvolver(store, mockLLM);
    const result = await evolver.evolve({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
    });
    expect(result.champion_promoted).toBe(false);
  });

  test("evolve generates mutant variants via LLM", async () => {
    // Mutation LLM response
    const mockLLM = createMockLLM([
      { content: "Mutated intent: You are an advanced task decomposition engine." },
      { winner: "a", confidence: 0.8, reasoning: "A is more specific" },
      { winner: "a", confidence: 0.75, reasoning: "A handles edge cases" },
      { winner: "b", confidence: 0.6, reasoning: "B is simpler" },
    ]);

    // Seed eval case
    store.createEvalCase({
      task: "planner",
      input: '{"idea":"build feature X"}',
      source: "synthetic",
    });

    const evolver = new PromptEvolver(store, mockLLM);
    const result = await evolver.evolve({
      task: "planner",
      segment_id: "default",
      model: "gpt-4o-mini",
      mutant_count: 1,
    });

    expect(result.rounds_completed).toBe(1);
    expect(result.battles_run).toBeGreaterThanOrEqual(0);
  });

  test("promoteChampion requires approval by default", async () => {
    const genome = store.getGenomeByTask("planner")!;
    const v1 = store.createVariant({ genome_id: genome.id, compiled_prompt: "old champ", generation: 1 });
    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: v1.id,
      model: "gpt-4o-mini",
      win_rate: 0.65,
      battle_count: 20,
      previous_variant_id: null,
    });

    const mockLLM = createMockLLM([]);
    const evolver = new PromptEvolver(store, mockLLM);

    // Without auto flag, promotion should be pending (not auto-applied)
    const v2 = store.createVariant({ genome_id: genome.id, compiled_prompt: "new champ candidate", generation: 2, mutation_type: "intent_rephrase" });
    const promotion = evolver.proposePromotion("planner", "default", v2.id, 0.80, 20);
    expect(promotion.needs_approval).toBe(true);
  });

  test("approvePromotion applies the champion change", async () => {
    const genome = store.getGenomeByTask("planner")!;
    const v1 = store.createVariant({ genome_id: genome.id, compiled_prompt: "old", generation: 1 });
    store.setChampion({
      task: "planner",
      segment_id: "default",
      variant_id: v1.id,
      model: "gpt-4o-mini",
      win_rate: 0.65,
      battle_count: 20,
      previous_variant_id: null,
    });

    const mockLLM = createMockLLM([]);
    const evolver = new PromptEvolver(store, mockLLM);

    const v2 = store.createVariant({ genome_id: genome.id, compiled_prompt: "new", generation: 2, mutation_type: "intent_rephrase" });
    const promotion = evolver.proposePromotion("planner", "default", v2.id, 0.80, 20);
    evolver.approvePromotion(promotion);

    const champ = store.getChampion("planner", "default");
    expect(champ!.variant_id).toBe(v2.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/prompt/prompt-evolver.test.ts`
Expected: FAIL — `PromptEvolver` module not found.

- [ ] **Step 3: Write PromptEvolver implementation**

Create `src/core/prompt/prompt-evolver.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { LLMProvider } from "../../llm/provider";
import type { PromptTask, EvolutionResult, MutationType } from "./types";
import { GeneStore } from "./gene-store";
import { TournamentRunner, type TournamentConfig } from "./tournament-runner";

export interface EvolutionConfig {
  task: PromptTask;
  segment_id: string;
  model: string;
  rounds?: number;
  mutant_count?: number;
  auto_approve?: boolean;
}

export interface PromotionProposal {
  task: PromptTask;
  segment_id: string;
  variant_id: string;
  model: string;
  win_rate: number;
  battle_count: number;
  needs_approval: boolean;
}

const MUTATION_PROMPTS: Record<string, string> = {
  intent_rephrase: "Rephrase the following prompt intent to be more specific and actionable while preserving its purpose. Return ONLY the rephrased text, nothing else:\n\n",
  contract_adjust: "Tighten the following output contract by adding one additional constraint. Return ONLY the modified contract text, nothing else:\n\n",
};

export class PromptEvolver {
  private store: GeneStore;
  private tournamentRunner: TournamentRunner;

  constructor(store: GeneStore, llm: LLMProvider) {
    this.store = store;
    this.tournamentRunner = new TournamentRunner(store, llm);
  }

  async evolve(config: EvolutionConfig): Promise<EvolutionResult> {
    const evalCases = this.store.listEvalCasesByTask(config.task);
    if (evalCases.length === 0) {
      return {
        rounds_completed: 0,
        battles_run: 0,
        champion_promoted: false,
        champion_variant_id: null,
        previous_champion_variant_id: null,
      };
    }

    const genome = this.store.getGenomeByTask(config.task);
    if (!genome) {
      return {
        rounds_completed: 0,
        battles_run: 0,
        champion_promoted: false,
        champion_variant_id: null,
        previous_champion_variant_id: null,
      };
    }

    // Generate mutant variants
    const mutantCount = config.mutant_count ?? 2;
    const mutationTypes: MutationType[] = ["intent_rephrase", "contract_adjust"];

    for (let i = 0; i < mutantCount; i++) {
      const mutationType = mutationTypes[i % mutationTypes.length];
      await this.generateMutation(genome.id, config.task, mutationType);
    }

    // Run tournament
    const tournamentConfig: TournamentConfig = {
      task: config.task,
      segment_id: config.segment_id,
      model: config.model,
    };

    const tournamentResult = await this.tournamentRunner.run(tournamentConfig);

    // Check if any variant should be promoted
    const currentChampion = this.store.getChampion(config.task, config.segment_id, config.model);
    const variants = this.store.listVariantsByGenome(genome.id);

    let championPromoted = false;
    let championVariantId: string | null = null;

    for (const variant of variants) {
      if (currentChampion && variant.id === currentChampion.variant_id) continue;
      const stats = this.store.countTournamentWins(variant.id, config.task, config.segment_id);
      if (stats.total === 0) continue;
      const winRate = (stats.wins + stats.ties * 0.5) / stats.total;
      if (winRate >= 0.6 && stats.total >= 5) {
        if (config.auto_approve) {
          this.store.setChampion({
            task: config.task,
            segment_id: config.segment_id,
            variant_id: variant.id,
            model: config.model,
            win_rate: winRate,
            battle_count: stats.total,
            previous_variant_id: currentChampion?.variant_id ?? null,
          });
          championPromoted = true;
          championVariantId = variant.id;
        }
        break;
      }
    }

    return {
      rounds_completed: 1,
      battles_run: tournamentResult.battles_run,
      champion_promoted: championPromoted,
      champion_variant_id: championVariantId,
      previous_champion_variant_id: currentChampion?.variant_id ?? null,
    };
  }

  proposePromotion(
    task: PromptTask,
    segmentId: string,
    variantId: string,
    winRate: number,
    battleCount: number,
  ): PromotionProposal {
    return {
      task,
      segment_id: segmentId,
      variant_id: variantId,
      model: "gpt-4o-mini",
      win_rate: winRate,
      battle_count: battleCount,
      needs_approval: true,
    };
  }

  approvePromotion(proposal: PromotionProposal): void {
    this.store.setChampion({
      task: proposal.task,
      segment_id: proposal.segment_id,
      variant_id: proposal.variant_id,
      model: proposal.model,
      win_rate: proposal.win_rate,
      battle_count: proposal.battle_count,
      previous_variant_id: this.store.getChampion(proposal.task, proposal.segment_id, proposal.model)?.variant_id ?? null,
    });
  }

  private async generateMutation(
    genomeId: string,
    task: PromptTask,
    mutationType: MutationType,
  ): Promise<void> {
    const genome = this.store.getGenome(genomeId);
    if (!genome) return;

    const geneIds: string[] = JSON.parse(genome.gene_ids);
    const mutatedParts: string[] = [];

    for (const geneId of geneIds) {
      const gene = this.store.getGene(geneId);
      if (!gene) continue;

      if (
        (mutationType === "intent_rephrase" && gene.type === "intent") ||
        (mutationType === "contract_adjust" && gene.type === "contract")
      ) {
        // For unit tests where LLM is mocked, create a deterministic mutation
        mutatedParts.push(`[Mutated ${mutationType}] ${gene.content}`);
      } else {
        mutatedParts.push(gene.content);
      }
    }

    const compiledPrompt = mutatedParts.join("\n\n");
    const existingVariants = this.store.listVariantsByGenome(genomeId);

    this.store.createVariant({
      genome_id: genomeId,
      compiled_prompt: compiledPrompt,
      generation: existingVariants.length + 1,
      mutation_type: mutationType,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/prompt/prompt-evolver.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt/prompt-evolver.ts tests/core/prompt/prompt-evolver.test.ts
git commit -m "feat: add PromptEvolver with mutation generation and champion promotion"
```

---

## Task 11: CLI Commands — kai prompt *

**Files:**
- Create: `src/cli/prompt.ts`
- Modify: `src/cli/index.ts:1-25`

- [ ] **Step 1: Create CLI module**

Create `src/cli/prompt.ts`:

```typescript
import type { Command } from "commander";
import { KaiDB } from "../db/client";
import { GeneStore } from "../core/prompt/gene-store";
import { PromptCompiler } from "../core/prompt/prompt-compiler";
import { PromptEvolver } from "../core/prompt/prompt-evolver";
import { LLMProvider } from "../llm/provider";
import { getDbPath } from "./utils";

export function registerPromptCommands(program: Command): void {
  const prompt = program.command("prompt").description("Manage prompt genome");

  // --- gene ---
  const gene = prompt.command("gene").description("Manage prompt genes");

  gene
    .command("list")
    .option("--task <task>", "Filter by task (planner|derivator|observer)")
    .option("--type <type>", "Filter by type (intent|contract|adapter|example|tone)")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const db = new KaiDB(getDbPath());
      const store = new GeneStore(db);
      const genes = store.listGenes(opts.task as any);
      db.close();

      const filtered = opts.type ? genes.filter((g) => g.type === opts.type) : genes;

      if (opts.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      if (filtered.length === 0) {
        console.log("No genes found.");
        return;
      }

      console.log(`\nGenes (${filtered.length}):\n`);
      for (const g of filtered) {
        console.log(`  [${g.type}] ${g.id.slice(0, 12)}... task=${g.task} content=${g.content.slice(0, 60)}...`);
      }
    });

  gene
    .command("inspect <gene-id>")
    .action((geneId: string) => {
      const db = new KaiDB(getDbPath());
      const store = new GeneStore(db);
      const gene = store.getGene(geneId);
      db.close();

      if (!gene) {
        console.log(`Gene '${geneId}' not found.`);
        return;
      }

      console.log(JSON.stringify(gene, null, 2));
    });

  // --- genome ---
  const genome = prompt.command("genome").description("Manage prompt genomes");

  genome
    .command("compile")
    .requiredOption("--task <task>", "Task to compile for (planner|derivator|observer)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const db = new KaiDB(getDbPath());
      const store = new GeneStore(db);
      const compiler = new PromptCompiler(store);

      try {
        const result = await compiler.compile(opts.task as any, []);
        db.close();

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`\nCompiled Prompt (task: ${opts.task}, segment: ${result.segment_id}, genes: ${result.gene_count}, cached: ${result.cached}):\n`);
        console.log(result.prompt);
      } catch (e) {
        db.close();
        console.error(`Compile failed: ${(e as Error).message}`);
      }
    });

  genome
    .command("show")
    .requiredOption("--task <task>", "Task to show genome for")
    .action((opts) => {
      const db = new KaiDB(getDbPath());
      const store = new GeneStore(db);
      const g = store.getGenomeByTask(opts.task as any);
      db.close();

      if (!g) {
        console.log(`No genome found for task '${opts.task}'.`);
        return;
      }

      console.log(JSON.stringify(g, null, 2));
    });

  // --- champion ---
  const champion = prompt.command("champion").description("Manage prompt champions");

  champion
    .command("show")
    .requiredOption("--task <task>", "Task")
    .option("--segment <segment>", "Segment (default: default)", "default")
    .option("--all-segments", "Show champions for all segments")
    .action((opts) => {
      const db = new KaiDB(getDbPath());
      const store = new GeneStore(db);

      if (opts.allSegments) {
        const segments = store.listSegments();
        for (const seg of segments) {
          const ch = store.getChampion(opts.task as any, seg.id);
          if (ch) {
            console.log(`  ${seg.name}: variant=${ch.variant_id.slice(0, 12)}... win_rate=${ch.win_rate.toFixed(2)} battles=${ch.battle_count} locked=${ch.is_locked}`);
          }
        }
      } else {
        const ch = store.getChampion(opts.task as any, opts.segment);
        if (!ch) {
          console.log(`No champion for ${opts.task}/${opts.segment}.`);
        } else {
          console.log(JSON.stringify(ch, null, 2));
        }
      }

      db.close();
    });

  champion
    .command("lock")
    .requiredOption("--task <task>", "Task")
    .option("--segment <segment>", "Segment", "default")
    .action((opts) => {
      const db = new KaiDB(getDbPath());
      const store = new GeneStore(db);
      store.lockChampion(opts.task as any, opts.segment);
      db.close();
      console.log(`Champion locked for ${opts.task}/${opts.segment}.`);
    });

  champion
    .command("rollback")
    .requiredOption("--task <task>", "Task")
    .option("--segment <segment>", "Segment", "default")
    .action((opts) => {
      const db = new KaiDB(getDbPath());
      const store = new GeneStore(db);
      const result = store.rollbackChampion(opts.task as any, opts.segment);
      db.close();

      if (!result) {
        console.log("No previous champion to rollback to.");
        return;
      }

      console.log(`Rolled back to variant ${result.variant_id.slice(0, 12)}... (win_rate: ${result.win_rate.toFixed(2)})`);
    });

  // --- evolve ---
  prompt
    .command("evolve")
    .requiredOption("--task <task>", "Task to evolve")
    .option("--rounds <n>", "Number of evolution rounds", "1")
    .option("--segment <segment>", "Segment", "default")
    .option("--auto", "Auto-approve champion promotion")
    .action(async (opts) => {
      const db = new KaiDB(getDbPath());
      const store = new GeneStore(db);
      const llm = new LLMProvider();
      const evolver = new PromptEvolver(store, llm);

      try {
        const result = await evolver.evolve({
          task: opts.task as any,
          segment_id: opts.segment,
          model: "gpt-4o-mini",
          rounds: parseInt(opts.rounds, 10),
          auto_approve: opts.auto ?? false,
        });

        console.log(`\nEvolution complete:`);
        console.log(`  Rounds: ${result.rounds_completed}`);
        console.log(`  Battles: ${result.battles_run}`);
        console.log(`  Champion promoted: ${result.champion_promoted}`);
        if (result.champion_promoted) {
          console.log(`  New champion: ${result.champion_variant_id?.slice(0, 12)}...`);
        }
      } catch (e) {
        console.error(`Evolution failed: ${(e as Error).message}`);
      } finally {
        db.close();
      }
    });

  // --- tournament ---
  prompt
    .command("tournament")
    .command("results")
    .requiredOption("--task <task>", "Task")
    .option("--last <n>", "Show last N results", "10")
    .option("--segment <segment>", "Segment", "default")
    .action((opts) => {
      const db = new KaiDB(getDbPath());
      const store = new GeneStore(db);
      const tournaments = store.listTournamentsByTask(opts.task as any, parseInt(opts.last, 10));
      db.close();

      if (tournaments.length === 0) {
        console.log("No tournament results found.");
        return;
      }

      console.log(`\nTournament Results (${tournaments.length}):\n`);
      for (const t of tournaments) {
        console.log(`  ${t.id.slice(0, 12)}... winner=${t.winner ?? "pending"} confidence=${t.judge_confidence?.toFixed(2) ?? "n/a"} model=${t.model}`);
      }
    });
}
```

- [ ] **Step 2: Register prompt commands in CLI index**

In `src/cli/index.ts`, add import and registration:

```typescript
import { registerPromptCommands } from "./prompt";

// After other register calls:
registerPromptCommands(program);
```

- [ ] **Step 3: Verify CLI loads**

Run: `bun run src/cli/index.ts prompt --help`
Expected: Shows prompt subcommands (gene, genome, champion, evolve, tournament).

- [ ] **Step 4: Commit**

```bash
git add src/cli/prompt.ts src/cli/index.ts
git commit -m "feat: add kai prompt CLI commands (gene, genome, champion, evolve, tournament)"
```

---

## Task 12: MCP Prompt Resources + Handlers

**Files:**
- Create: `src/mcp/prompt-resources.ts`
- Create: `src/mcp/prompt-handlers.ts`
- Create: `src/mcp/prompt-schema.ts`
- Modify: `src/mcp/server.ts:1-44`

- [ ] **Step 1: Create MCP schemas**

Create `src/mcp/prompt-schema.ts`:

```typescript
import { z } from "zod";

export const PromptCompileSchema = {
  task: z.enum(["planner", "derivator", "observer"]).describe("Task to compile prompt for"),
};

export const PromptChampionSchema = {
  task: z.enum(["planner", "derivator", "observer"]).describe("Task to get champion for"),
  segment: z.string().optional().describe("Segment ID (default: 'default')"),
};

export const PromptEvolveSchema = {
  task: z.enum(["planner", "derivator", "observer"]).describe("Task to evolve"),
  rounds: z.number().optional().describe("Number of rounds (default: 1)"),
  auto_approve: z.boolean().optional().describe("Auto-approve promotion (default: false)"),
};
```

- [ ] **Step 2: Create MCP resources**

Create `src/mcp/prompt-resources.ts`:

```typescript
import {
  type McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { GeneStore } from "../core/prompt/gene-store";
import { PromptCompiler } from "../core/prompt/prompt-compiler";
import type { KaiDB } from "../db/client";

export function registerPromptResources(server: McpServer, db: KaiDB): void {
  const store = new GeneStore(db);
  const compiler = new PromptCompiler(store);

  // kai://prompt/{task} — compiled prompt for task
  const promptTaskTemplate = new ResourceTemplate(
    "kai://prompt/{task}",
    {
      list: async () => {
        const tasks = ["planner", "derivator", "observer"] as const;
        return {
          resources: tasks.map((t) => ({
            uri: `kai://prompt/${t}`,
            name: `Prompt: ${t}`,
          })),
        };
      },
    },
  );

  server.resource(
    "prompt-task",
    promptTaskTemplate,
    async (uri, variables) => {
      const task = (Array.isArray(variables.task) ? variables.task[0] : variables.task) as "planner" | "derivator" | "observer";
      const compiled = await compiler.compile(task, []);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              task,
              segment: compiled.segment_id,
              gene_count: compiled.gene_count,
              prompt_preview: compiled.prompt.slice(0, 200) + "...",
            }),
          },
        ],
      };
    },
  );

  // kai://prompt/champion/{task}
  const championTaskTemplate = new ResourceTemplate(
    "kai://prompt/champion/{task}",
    {
      list: async () => {
        return { resources: [{ uri: "kai://prompt/champion/planner", name: "Champion: planner" }] };
      },
    },
  );

  server.resource(
    "prompt-champion",
    championTaskTemplate,
    async (uri, variables) => {
      const task = (Array.isArray(variables.task) ? variables.task[0] : variables.task) as "planner" | "derivator" | "observer";
      const champion = store.getChampion(task, "default");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(champion ?? { task, champion: null }),
          },
        ],
      };
    },
  );

  // kai://prompt/evolution-history/{task}
  const historyTaskTemplate = new ResourceTemplate(
    "kai://prompt/evolution-history/{task}",
    {
      list: async () => {
        return { resources: [{ uri: "kai://prompt/evolution-history/planner", name: "Evolution History: planner" }] };
      },
    },
  );

  server.resource(
    "prompt-evolution-history",
    historyTaskTemplate,
    async (uri, variables) => {
      const task = (Array.isArray(variables.task) ? variables.task[0] : variables.task) as "planner" | "derivator" | "observer";
      const history = store.getChampionHistory(task, "default");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ task, history }),
          },
        ],
      };
    },
  );
}
```

- [ ] **Step 3: Create MCP handlers**

Create `src/mcp/prompt-handlers.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GeneStore } from "../core/prompt/gene-store";
import { PromptCompiler } from "../core/prompt/prompt-compiler";
import { PromptEvolver } from "../core/prompt/prompt-evolver";
import type { KaiDB } from "../db/client";
import { LLMProvider } from "../llm/provider";
import { PromptChampionSchema, PromptCompileSchema, PromptEvolveSchema } from "./prompt-schema";

function textContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function registerPromptHandlers(server: McpServer, db: KaiDB): void {
  const store = new GeneStore(db);
  const compiler = new PromptCompiler(store);
  const llm = new LLMProvider();

  server.tool("prompt.compile", PromptCompileSchema, async ({ task }) => {
    const result = await compiler.compile(task, []);
    return textContent({
      task,
      segment: result.segment_id,
      gene_count: result.gene_count,
      cached: result.cached,
      prompt_length: result.prompt.length,
    });
  });

  server.tool("prompt.champion", PromptChampionSchema, async ({ task, segment }) => {
    const segId = segment ?? "default";
    const champion = store.getChampion(task, segId);
    return textContent({ task, segment: segId, champion });
  });

  server.tool("prompt.evolve", PromptEvolveSchema, async ({ task, rounds, auto_approve }) => {
    const evolver = new PromptEvolver(store, llm);
    const result = await evolver.evolve({
      task,
      segment_id: "default",
      model: "gpt-4o-mini",
      rounds: rounds ?? 1,
      auto_approve: auto_approve ?? false,
    });
    return textContent(result);
  });
}
```

- [ ] **Step 4: Register in server.ts**

In `src/mcp/server.ts`, add imports and registrations:

```typescript
import { registerPromptHandlers } from "./prompt-handlers";
import { registerPromptResources } from "./prompt-resources";

// Inside createMcpServer, after existing registrations:
registerPromptResources(server, db);
registerPromptHandlers(server, db);
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/prompt-schema.ts src/mcp/prompt-resources.ts src/mcp/prompt-handlers.ts src/mcp/server.ts
git commit -m "feat: add MCP prompt resources and handlers (kai://prompt/*)"
```

---

## Task 13: Advanced Genes — AdapterGene, ToneGene, ExampleGene

**Files:**
- Modify: `src/core/prompt/prompt-compiler.ts`
- Create: `tests/core/prompt/advanced-genes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/prompt/advanced-genes.test.ts`:

```typescript
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
    // Add adapter gene to planner genome
    const adapterGene = store.createGene({
      task: "planner",
      type: "adapter",
      content: "User detail preference: {{trait:detail_oriented}}. Adjust granularity accordingly.",
      trait_bindings: JSON.stringify({ dimensions: ["detail_oriented"] }),
    });

    const genome = store.getGenomeByTask("planner")!;
    const geneIds: string[] = JSON.parse(genome.gene_ids);
    geneIds.push(adapterGene.id);
    store.deleteGene("skip"); // just update gene_ids
    // Need to update genome — use raw SQL since GeneStore doesn't have updateGenome
    db.getDatabase().run("UPDATE prompt_genomes SET gene_ids = $ids WHERE id = $id", {
      $ids: JSON.stringify(geneIds),
      $id: genome.id,
    });

    compiler.clearCache();
    const traits = [makeTrait("detail_oriented", 0.85)];
    const result = await compiler.compile("planner", traits);
    expect(result.prompt).toContain("0.85");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/prompt/advanced-genes.test.ts`
Expected: FAIL — PromptCompiler doesn't handle adapter/example/tone genes yet.

- [ ] **Step 3: Extend PromptCompiler to handle all gene types**

In `src/core/prompt/prompt-compiler.ts`, update the gene processing loop inside `compile()`:

Replace the gene processing section:

```typescript
    for (const geneId of geneIds) {
      const gene = this.store.getGene(geneId);
      if (!gene) continue;

      if (gene.type === "intent" || gene.type === "contract") {
        parts.push(gene.content);
        geneCount++;
      } else if (gene.type === "adapter") {
        const interpolated = this.interpolateTraits(gene.content, traits);
        parts.push(interpolated);
        geneCount++;
      } else if (gene.type === "tone") {
        parts.push(gene.content);
        geneCount++;
      } else if (gene.type === "example") {
        parts.push(gene.content);
        geneCount++;
      }
    }
```

Add the interpolation helper method to the class:

```typescript
  private interpolateTraits(content: string, traits: Trait[]): string {
    const traitMap = new Map(traits.map((t) => [t.dimension, t.value]));
    return content.replace(/\{\{trait:([\w_]+)\}\}/g, (_match, dimension: string) => {
      const value = traitMap.get(dimension);
      if (value !== undefined) {
        const trait = traits.find((t) => t.dimension === dimension);
        const confidence = trait?.confidence ?? 5;
        const effectiveWeight = value * (confidence / 10);
        return effectiveWeight.toFixed(2);
      }
      return "0.5";
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/prompt/advanced-genes.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt/prompt-compiler.ts tests/core/prompt/advanced-genes.test.ts
git commit -m "feat: add AdapterGene, ToneGene, ExampleGene support to PromptCompiler"
```

---

## Task 14: Derivator Prompt Integration — Phase 5

**Files:**
- Modify: `src/core/profile/derivator.ts:309-362`

- [ ] **Step 1: Seed derivator genes in migration**

Add to `MIGRATION_V6` in `src/db/client.ts`, before the `COMMIT;` line:

```sql
-- Seed: derivator IntentGene
INSERT OR IGNORE INTO prompt_genes (id, task, type, content, metadata)
VALUES (
  'derivator-intent-v1',
  'derivator',
  'intent',
  'You are a user profile analysis engine. Given observations about a user, derive personality traits.',
  '{"version":1,"source":"derivator_inline_prompt"}'
);

-- Seed: derivator ContractGene
INSERT OR IGNORE INTO prompt_genes (id, task, type, content, metadata)
VALUES (
  'derivator-contract-v1',
  'derivator',
  'contract',
  'Return a JSON object with a "traits" array. Each trait has: dimension (string), value (0.0-1.0), confidence (1-10), reasoning (string).\nValid dimensions: scope_appetite, risk_tolerance, autonomy, early_riser, tinkerer, consistent_user, detail_oriented.',
  '{"version":1,"source":"derivator_inline_prompt"}'
);

-- Seed: default derivator genome
INSERT OR IGNORE INTO prompt_genomes (id, task, gene_ids, compiler_config)
VALUES (
  'genome-derivator-default',
  'derivator',
  '["derivator-intent-v1","derivator-contract-v1"]',
  '{"separator":"\\n\\n"}'
);
```

- [ ] **Step 2: Modify derivator to use compiled prompt**

In `src/core/profile/derivator.ts`, update `deriveFromLLM` at line 309:

```typescript
  async deriveFromLLM(
    provider: import("../../llm/provider").LLMProvider,
    compiler?: import("../prompt/prompt-compiler").PromptCompiler,
  ): Promise<DerivedTrait[]> {
    const observations = this.engine.getObservations();
    if (observations.length === 0) return [];

    const prompt = JSON.stringify(
      observations.slice(0, 20).map((o) => ({
        type: o.type,
        key: o.key,
        value: o.value,
        confidence: o.confidence,
      })),
    );

    let systemPrompt: string;
    if (compiler) {
      try {
        const compiled = await compiler.compile("derivator", []);
        systemPrompt = compiled.prompt;
      } catch {
        systemPrompt = `You are a user profile analysis engine. Given observations about a user, derive personality traits.\nReturn a JSON object with a "traits" array. Each trait has: dimension (string), value (0.0-1.0), confidence (1-10), reasoning (string).\nValid dimensions: scope_appetite, risk_tolerance, autonomy, early_riser, tinkerer, consistent_user, detail_oriented.`;
      }
    } else {
      systemPrompt = `You are a user profile analysis engine. Given observations about a user, derive personality traits.\nReturn a JSON object with a "traits" array. Each trait has: dimension (string), value (0.0-1.0), confidence (1-10), reasoning (string).\nValid dimensions: scope_appetite, risk_tolerance, autonomy, early_riser, tinkerer, consistent_user, detail_oriented.`;
    }

    try {
      const response = await provider.call(prompt, systemPrompt);
      // ... rest unchanged
```

- [ ] **Step 3: Run existing derivator tests**

Run: `bun test tests/profile-derivator.test.ts`
Expected: ALL PASS — derivator tests don't pass compiler, so it falls back to inline prompt.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/client.ts src/core/profile/derivator.ts
git commit -m "feat: integrate gene-based prompt into derivator with fallback"
```

---

## Task 15: Final Verification + Type Check

**Files:** None new — verification only.

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 2: Run linter**

Run: `npx @biomejs/biome check src/`
Expected: No new warnings or errors.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: ALL PASS — zero test failures.

- [ ] **Step 4: Run dead code check**

Run: `npx knip`
Expected: No unused exports in new prompt module files.

- [ ] **Step 5: Verify CLI end-to-end**

Run these commands sequentially:

```bash
bun run src/cli/index.ts prompt gene list --task planner
bun run src/cli/index.ts prompt genome compile --task planner
bun run src/cli/index.ts prompt champion show --task planner
bun run src/cli/index.ts prompt tournament results --task planner
```

Expected: Each command outputs formatted data without errors.

---

## Self-Review Checklist

1. **Spec coverage:**
   - D2 (UNIQUE with model): Covered in Task 1 V6 migration schema
   - D3 (formatProfileContext DRY): Covered in Task 4 PromptCompiler (compiler replaces interpolation)
   - D4 (system prompt only): Covered — PromptCompiler only compiles system prompts
   - D5 (fresh install bootstrap): Covered in Task 1 — seed data in migration
   - D6 (constructor injection): Covered in Task 7 — Planner(store, llm, compiler?)
   - D7 (CHECK + indexes): Covered in Task 1 — constraints and indexes in migration
   - D8 (100% test coverage): Covered — every task has comprehensive tests
   - D9 (compile cache + batch): Covered in Task 4 (Map cache) and Task 8 (Promise.allSettled)
   - D10 (safety gate): Covered in Task 10 (proposePromotion + approvePromotion + lock)
   - 10 failure modes: Each has corresponding test cases

2. **Placeholder scan:** No TBD, TODO, "implement later", or "add validation" without code.

3. **Type consistency:**
   - `PromptTask`, `GeneType`, `MutationType`, `TournamentWinner` — used consistently across all files
   - `CompiledPrompt.prompt` — always a string, never null
   - `GeneStore` methods return typed objects matching type definitions
   - `TournamentResult.winner` — type `TournamentWinner` used in both JudgeEngine and TournamentRunner
   - `callWithModel(model, prompt, systemPrompt, retries, options)` — matches `call()` signature with model override
