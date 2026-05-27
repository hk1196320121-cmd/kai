export const MIGRATION_V4 = `
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
