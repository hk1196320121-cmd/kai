export const MIGRATION_V5 = `
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
