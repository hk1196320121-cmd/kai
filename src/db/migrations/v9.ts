import {
  sqlSourceCheck,
  sqlTypeCheck,
  VALID_OBSERVATION_SOURCES,
} from "../../core/profile/types";

export const MIGRATION_V9 = `
PRAGMA foreign_keys = OFF;
PRAGMA busy_timeout = 5000;

BEGIN TRANSACTION;

-- Drop temp table first for idempotent table-rebuild safety
DROP TABLE IF EXISTS observations_v9;

-- Expand observations type CHECK to include tool_usage + add source CHECK
CREATE TABLE observations_v9 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL ${sqlTypeCheck()},
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL DEFAULT 5 CHECK(confidence >= 1 AND confidence <= 10),
  source TEXT NOT NULL ${sqlSourceCheck()},
  provenance TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Map legacy source values (v5 had no CHECK, so arbitrary values could exist)
-- Unknown sources are mapped to 'session_log' to preserve data.
INSERT INTO observations_v9 (id, type, key, value, confidence, source, provenance, ts)
  SELECT id, type, key, value, confidence,
    CASE
      WHEN source IN (${VALID_OBSERVATION_SOURCES.map((s) => `'${s}'`).join(",")}) THEN source
      ELSE 'session_log'
    END,
    provenance, ts FROM observations;

DROP TABLE IF EXISTS observations;
ALTER TABLE observations_v9 RENAME TO observations;

CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_key ON observations(key);
CREATE INDEX IF NOT EXISTS idx_observations_ts ON observations(ts);
CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source);

-- New table: autopilot_sessions
CREATE TABLE IF NOT EXISTS autopilot_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  stopped_at TEXT,
  observations_count INTEGER DEFAULT 0,
  traits_derived INTEGER DEFAULT 0,
  traits_changed INTEGER DEFAULT 0,
  derivation_status TEXT NOT NULL DEFAULT 'pending' CHECK(derivation_status IN ('pending','completed','failed','skipped')),
  project_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_autopilot_sessions_started
  ON autopilot_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_autopilot_sessions_session_id
  ON autopilot_sessions(session_id);

INSERT OR REPLACE INTO schema_version (version) VALUES (9);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;
