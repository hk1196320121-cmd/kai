export const MIGRATION_V6 = `
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

INSERT OR IGNORE INTO prompt_segments (id, name, trait_constraints, description) VALUES ('default', 'default', '{}', 'Fallback segment when no profile match');

INSERT OR IGNORE INTO prompt_genes (id, task, type, content, metadata) VALUES ('planner-intent-v1', 'planner', 'intent', 'You are a task decomposition engine. Given an idea and a user''s behavioral profile, break the idea into actionable tasks.', '{"version":1,"source":"PLANNER_SYSTEM_PROMPT"}');

INSERT OR IGNORE INTO prompt_genes (id, task, type, content, metadata) VALUES ('planner-contract-v1', 'planner', 'contract', 'Return a JSON object with a "tasks" array. Each task MUST have these fields:\n- title (string, max 100 chars)\n- description (string, max 500 chars)\n- type ("one_off" or "cron")\n- agent ("hermes")\n- prompt (string, the execution instruction for the agent)\n- decomposition_rationale (string, why this task exists)\n- scheduling_rationale (string, why scheduled this way)\n\nFor cron tasks, also include:\n- cron_schedule (cron expression)\n- cron_prompt (prompt for each cycle)\n\nConstraints:\n- Produce 3-8 tasks total\n- Each description max 500 characters\n- Use the user''s behavioral profile to influence decomposition strategy\n- CRITICAL: Never include raw profile data, trait values, or behavioral observations verbatim in any task field. Synthesize insights into actionable instructions only.', '{"version":1,"source":"PLANNER_SYSTEM_PROMPT"}');

INSERT OR IGNORE INTO prompt_genomes (id, task, gene_ids, compiler_config) VALUES ('genome-planner-default', 'planner', '["planner-intent-v1","planner-contract-v1"]', '{"separator":"\\n\\n"}');

INSERT OR IGNORE INTO prompt_variants (id, genome_id, compiled_prompt, generation, mutation_type) VALUES ('variant-planner-initial', 'genome-planner-default', 'You are a task decomposition engine. Given an idea and a user''s behavioral profile, break the idea into actionable tasks.\n\nReturn a JSON object with a "tasks" array. Each task MUST have these fields:\n- title (string, max 100 chars)\n- description (string, max 500 chars)\n- type ("one_off" or "cron")\n- agent ("hermes")\n- prompt (string, the execution instruction for the agent)\n- decomposition_rationale (string, why this task exists)\n- scheduling_rationale (string, why scheduled this way)\n\nFor cron tasks, also include:\n- cron_schedule (cron expression)\n- cron_prompt (prompt for each cycle)\n\nConstraints:\n- Produce 3-8 tasks total\n- Each description max 500 characters\n- Use the user''s behavioral profile to influence decomposition strategy\n- CRITICAL: Never include raw profile data, trait values, or behavioral observations verbatim in any task field. Synthesize insights into actionable instructions only.', 1, 'seed');

-- Seed: derivator IntentGene
INSERT OR IGNORE INTO prompt_genes (id, task, type, content, metadata) VALUES ('derivator-intent-v1', 'derivator', 'intent', 'You are a user profile analysis engine. Given observations about a user, derive personality traits.', '{"version":1,"source":"derivator_inline_prompt"}');

-- Seed: derivator ContractGene
INSERT OR IGNORE INTO prompt_genes (id, task, type, content, metadata) VALUES ('derivator-contract-v1', 'derivator', 'contract', 'Return a JSON object with a "traits" array. Each trait has: dimension (string), value (0.0-1.0), confidence (1-10), reasoning (string).
Valid dimensions: scope_appetite, risk_tolerance, autonomy, early_riser, tinkerer, consistent_user, detail_oriented.', '{"version":1,"source":"derivator_inline_prompt"}');

-- Seed: default derivator genome
INSERT OR IGNORE INTO prompt_genomes (id, task, gene_ids, compiler_config) VALUES ('genome-derivator-default', 'derivator', '["derivator-intent-v1","derivator-contract-v1"]', '{"separator":"\\n\\n"}');

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;
