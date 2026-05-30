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
-- Add session_id column for FK link to autopilot_sessions
CREATE TABLE observations_v9 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL ${sqlTypeCheck()},
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL DEFAULT 5 CHECK(confidence >= 1 AND confidence <= 10),
  source TEXT NOT NULL ${sqlSourceCheck()},
  provenance TEXT NOT NULL DEFAULT '{}',
  session_id TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Map legacy source values (v5 had no CHECK, so arbitrary values could exist)
-- Unknown sources are mapped to 'session_log' to preserve data.
-- session_id is NULL for pre-v9 observations (no session tracking existed).
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
CREATE INDEX IF NOT EXISTS idx_observations_session_id ON observations(session_id);

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

/**
 * Down-migration for V9: reverses schema changes for safe rollback to pre-v9 code.
 * WARNING: This drops the autopilot_sessions table and the session_id column.
 * Session data is lost; observation data is preserved.
 */
export const MIGRATION_V9_DOWN = `
PRAGMA foreign_keys = OFF;
PRAGMA busy_timeout = 5000;

BEGIN TRANSACTION;

-- Drop autopilot_sessions table (session data lost on rollback)
DROP TABLE IF EXISTS autopilot_sessions;

-- Rebuild observations without session_id column and with relaxed CHECK constraints
-- that pre-v9 code expects (no tool_usage type, no source CHECK)
DROP TABLE IF EXISTS observations_v8;
CREATE TABLE observations_v8 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL DEFAULT 5 CHECK(confidence >= 1 AND confidence <= 10),
  source TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO observations_v8 (id, type, key, value, confidence, source, provenance, ts)
  SELECT id, type, key, value, confidence, source, provenance, ts FROM observations;

DROP TABLE observations;
ALTER TABLE observations_v8 RENAME TO observations;

CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_key ON observations(key);
CREATE INDEX IF NOT EXISTS idx_observations_ts ON observations(ts);

INSERT OR REPLACE INTO schema_version (version) VALUES (8);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;
