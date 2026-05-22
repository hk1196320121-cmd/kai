import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS identity (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '[]',
  expertise_areas TEXT NOT NULL DEFAULT '[]',
  learning_interests TEXT NOT NULL DEFAULT '[]',
  work_context TEXT NOT NULL DEFAULT '',
  communication_style TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS traits (
  id TEXT PRIMARY KEY,
  dimension TEXT NOT NULL,
  value REAL NOT NULL CHECK(value >= 0.0 AND value <= 1.0),
  confidence INTEGER NOT NULL DEFAULT 1 CHECK(confidence >= 1 AND confidence <= 10),
  source TEXT NOT NULL CHECK(source IN ('declared','observed','inferred','cross-model')),
  reasoning TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(dimension)
);

CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('user-stated','inferred')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('behavior','preference','feedback','context','signal')),
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL DEFAULT 5 CHECK(confidence >= 1 AND confidence <= 10),
  source TEXT NOT NULL CHECK(source IN ('cron_output','session_log','user_stated','inferred')),
  provenance TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_key ON observations(key);
CREATE INDEX IF NOT EXISTS idx_observations_ts ON observations(ts);
CREATE INDEX IF NOT EXISTS idx_traits_dimension ON traits(dimension);
`;

const MIGRATION_V2 = `
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS observations_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('behavior','preference','feedback','context','signal')),
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL DEFAULT 5 CHECK(confidence >= 1 AND confidence <= 10),
  source TEXT NOT NULL CHECK(source IN ('cron_output','session_log','user_stated','inferred','mcp')),
  provenance TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO observations_v2 (id, type, key, value, confidence, source, provenance, ts)
  SELECT id, type, key, value, confidence, source, provenance, ts FROM observations;

DROP TABLE IF EXISTS observations;
ALTER TABLE observations_v2 RENAME TO observations;

CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_key ON observations(key);
CREATE INDEX IF NOT EXISTS idx_observations_ts ON observations(ts);

COMMIT;
`;

const MIGRATION_V3 = `
CREATE TABLE IF NOT EXISTS corrections (
  dimension TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  corrected_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(dimension)
);
`;

const MIGRATION_V4 = `
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- New workspace tables
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','completed')),
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES workspace_tasks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('workspace_created','task_created','task_updated','task_completed','interaction','coldstart_answer','workspace_archived')),
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_events_type ON workspace_events(event_type);
CREATE INDEX IF NOT EXISTS idx_workspace_events_workspace ON workspace_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_workspace ON workspace_tasks(workspace_id);

-- Expand observation source enum
CREATE TABLE IF NOT EXISTS observations_v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('behavior','preference','feedback','context','signal')),
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL DEFAULT 5 CHECK(confidence >= 1 AND confidence <= 10),
  source TEXT NOT NULL CHECK(source IN ('cron_output','session_log','user_stated','inferred','mcp','coldstart','workspace')),
  provenance TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO observations_v4 (id, type, key, value, confidence, source, provenance, ts)
  SELECT id, type, key, value, confidence, source, provenance, ts FROM observations;

DROP TABLE IF EXISTS observations;
ALTER TABLE observations_v4 RENAME TO observations;

CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_key ON observations(key);
CREATE INDEX IF NOT EXISTS idx_observations_ts ON observations(ts);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;

const MIGRATION_V5 = `
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'medium',
  deadline TEXT,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS planned_tasks (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'one_off',
  cron_schedule TEXT,
  cron_prompt TEXT,
  agent TEXT NOT NULL DEFAULT 'hermes',
  prompt TEXT NOT NULL,
  decomposition_rationale TEXT NOT NULL DEFAULT '',
  scheduling_rationale TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS execution_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES planned_tasks(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  success INTEGER NOT NULL CHECK(success IN (0,1)),
  output TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER,
  user_feedback TEXT,
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_workspace ON ideas(workspace_id);
CREATE INDEX IF NOT EXISTS idx_planned_tasks_idea ON planned_tasks(idea_id);
CREATE INDEX IF NOT EXISTS idx_planned_tasks_status ON planned_tasks(status);
CREATE INDEX IF NOT EXISTS idx_execution_results_task ON execution_results(task_id);

CREATE TABLE IF NOT EXISTS observations_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('behavior','preference','feedback','context','signal')),
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL DEFAULT 5 CHECK(confidence >= 1 AND confidence <= 10),
  source TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO observations_v5 (id, type, key, value, confidence, source, provenance, ts)
  SELECT id, type, key, value, confidence, source, provenance, ts FROM observations;

DROP TABLE IF EXISTS observations;
ALTER TABLE observations_v5 RENAME TO observations;

CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_key ON observations(key);
CREATE INDEX IF NOT EXISTS idx_observations_ts ON observations(ts);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;

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

const MIGRATION_V7 = `
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS runtime_traces (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  tool_name TEXT,
  root_cause TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS runtime_spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES runtime_traces(id),
  parent_span_id TEXT REFERENCES runtime_spans(id),
  operation TEXT NOT NULL,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  attributes TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS runtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  span_id TEXT NOT NULL REFERENCES runtime_spans(id),
  trace_id TEXT NOT NULL REFERENCES runtime_traces(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runtime_state_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  span_id TEXT NOT NULL REFERENCES runtime_spans(id),
  trace_id TEXT NOT NULL REFERENCES runtime_traces(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runtime_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  span_id TEXT NOT NULL REFERENCES runtime_spans(id),
  trace_id TEXT NOT NULL REFERENCES runtime_traces(id),
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT,
  recoverable INTEGER NOT NULL DEFAULT 0,
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_traces_started ON runtime_traces(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_status ON runtime_traces(status);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON runtime_spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_operation ON runtime_spans(operation);
CREATE INDEX IF NOT EXISTS idx_events_trace ON runtime_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_state_changes_entity ON runtime_state_changes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_errors_trace ON runtime_errors(trace_id);
CREATE INDEX IF NOT EXISTS idx_errors_created ON runtime_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_created ON runtime_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_span ON runtime_events(span_id);
CREATE INDEX IF NOT EXISTS idx_state_changes_created ON runtime_state_changes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_changes_trace ON runtime_state_changes(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_started ON runtime_spans(started_at DESC);

CREATE VIEW IF NOT EXISTS telemetry_traces_v1 AS
  SELECT id, trigger, tool_name, started_at, duration_ms, status FROM runtime_traces;
CREATE VIEW IF NOT EXISTS telemetry_spans_v1 AS
  SELECT id, trace_id, parent_span_id, operation, name, started_at, duration_ms, status, attributes FROM runtime_spans;
CREATE VIEW IF NOT EXISTS telemetry_events_v1 AS
  SELECT id, span_id, trace_id, type, name, payload, created_at FROM runtime_events;
CREATE VIEW IF NOT EXISTS telemetry_state_changes_v1 AS
  SELECT id, span_id, trace_id, entity_type, entity_id, field, old_value, new_value, reason, created_at FROM runtime_state_changes;
CREATE VIEW IF NOT EXISTS telemetry_errors_v1 AS
  SELECT id, span_id, trace_id, error_type, message, recoverable, context, created_at FROM runtime_errors;

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;

const MIGRATION_V8 = `
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS workspace_events_v8 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES workspace_tasks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('workspace_created','task_created','task_updated','task_completed','interaction','coldstart_answer','workspace_archived','recommendation_shown','recommendation_accepted','recommendation_rejected','task_auto_executed')),
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO workspace_events_v8 (id, workspace_id, task_id, event_type, payload, created_at)
  SELECT id, workspace_id, task_id, event_type, payload, created_at FROM workspace_events;

DROP TABLE IF EXISTS workspace_events;
ALTER TABLE workspace_events_v8 RENAME TO workspace_events;

CREATE INDEX IF NOT EXISTS idx_workspace_events_type ON workspace_events(event_type);
CREATE INDEX IF NOT EXISTS idx_workspace_events_workspace ON workspace_events(workspace_id);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;

export class KaiDB {
  private db: Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.runMigrations();
  }

  runMigrations(): void {
    const currentVersion = this.getVersion();
    if (currentVersion < 1) {
      this.db.exec(SCHEMA_SQL);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [1],
      );
    }
    if (currentVersion < 2) {
      this.db.exec(MIGRATION_V2);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [2],
      );
    }
    if (currentVersion < 3) {
      this.db.exec(MIGRATION_V3);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [3],
      );
    }
    if (currentVersion < 4) {
      this.db.exec(MIGRATION_V4);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [4],
      );
    }
    if (currentVersion < 5) {
      this.db.exec(MIGRATION_V5);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [5],
      );
    }
    if (currentVersion < 6) {
      this.db.exec(MIGRATION_V6);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [6],
      );
    }
    if (currentVersion < 7) {
      this.db.exec(MIGRATION_V7);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [7],
      );
    }
    if (currentVersion < 8) {
      this.db.exec(MIGRATION_V8);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [8],
      );
    }
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run("PRAGMA busy_timeout = 5000");
  }

  private getVersion(): number {
    try {
      const row = this.db
        .query("SELECT MAX(version) as v FROM schema_version")
        .get() as { v: number | null } | null;
      return row?.v ?? 0;
    } catch {
      return 0;
    }
  }

  listTables(): string[] {
    const rows = this.db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  getJournalMode(): string {
    const row = this.db.query("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    return row.journal_mode;
  }

  integrityCheck(): string {
    const row = this.db.query("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    return row.integrity_check;
  }

  getDatabase(): Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
