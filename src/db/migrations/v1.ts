export const MIGRATION_V1 = `
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
