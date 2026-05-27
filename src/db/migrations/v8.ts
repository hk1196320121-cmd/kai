export const MIGRATION_V8 = `
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

INSERT OR REPLACE INTO schema_version (version) VALUES (8);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;
