import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./migrations";

export class KaiDB {
  private db: Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    // Restrict DB file permissions to owner-only
    try {
      const { chmodSync, existsSync } = require("node:fs");
      chmodSync(dbPath, 0o600);
      if (existsSync(dbPath + "-wal")) chmodSync(dbPath + "-wal", 0o600);
      if (existsSync(dbPath + "-shm")) chmodSync(dbPath + "-shm", 0o600);
    } catch {
      // Non-critical — permission hardening is best-effort
    }
    this.runMigrations();
  }

  runMigrations(): void {
    const currentVersion = this.getVersion();
    for (const migration of MIGRATIONS) {
      if (currentVersion < migration.version) {
        this.db.exec(migration.sql);
        if (!migration.selfBumps) {
          this.db.run(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
            [migration.version],
          );
        }
      }
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
