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
