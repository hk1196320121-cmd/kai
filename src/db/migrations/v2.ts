export const MIGRATION_V2 = `
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
