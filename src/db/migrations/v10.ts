export const MIGRATION_V10 = `
PRAGMA foreign_keys = OFF;
PRAGMA busy_timeout = 5000;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS dispatch_decisions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES planned_tasks(id),
  agent TEXT NOT NULL,
  confidence REAL NOT NULL,
  reasoning TEXT NOT NULL,
  user_decision TEXT NOT NULL DEFAULT 'pending'
    CHECK(user_decision IN ('approved', 'rejected', 'pending')),
  user_reason TEXT,
  policy_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dispatch_decisions_task_id
  ON dispatch_decisions(task_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_decisions_user_decision
  ON dispatch_decisions(user_decision);

INSERT OR REPLACE INTO schema_version (version) VALUES (10);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;
