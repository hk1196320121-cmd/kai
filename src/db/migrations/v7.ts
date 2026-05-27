export const MIGRATION_V7 = `
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS runtime_traces (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  tool_name TEXT,
  root_cause TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS runtime_spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES runtime_traces(id),
  parent_span_id TEXT REFERENCES runtime_spans(id),
  operation TEXT NOT NULL,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  attributes TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS runtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  span_id TEXT NOT NULL REFERENCES runtime_spans(id),
  trace_id TEXT NOT NULL REFERENCES runtime_traces(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runtime_state_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  span_id TEXT NOT NULL REFERENCES runtime_spans(id),
  trace_id TEXT NOT NULL REFERENCES runtime_traces(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runtime_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  span_id TEXT NOT NULL REFERENCES runtime_spans(id),
  trace_id TEXT NOT NULL REFERENCES runtime_traces(id),
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT,
  recoverable INTEGER NOT NULL DEFAULT 0,
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_traces_started ON runtime_traces(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_status ON runtime_traces(status);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON runtime_spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_operation ON runtime_spans(operation);
CREATE INDEX IF NOT EXISTS idx_events_trace ON runtime_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_state_changes_entity ON runtime_state_changes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_errors_trace ON runtime_errors(trace_id);
CREATE INDEX IF NOT EXISTS idx_errors_created ON runtime_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_created ON runtime_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_span ON runtime_events(span_id);
CREATE INDEX IF NOT EXISTS idx_state_changes_created ON runtime_state_changes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_changes_trace ON runtime_state_changes(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_started ON runtime_spans(started_at DESC);

CREATE VIEW IF NOT EXISTS telemetry_traces_v1 AS
  SELECT id, trigger, tool_name, started_at, duration_ms, status FROM runtime_traces;
CREATE VIEW IF NOT EXISTS telemetry_spans_v1 AS
  SELECT id, trace_id, parent_span_id, operation, name, started_at, duration_ms, status, attributes FROM runtime_spans;
CREATE VIEW IF NOT EXISTS telemetry_events_v1 AS
  SELECT id, span_id, trace_id, type, name, payload, created_at FROM runtime_events;
CREATE VIEW IF NOT EXISTS telemetry_state_changes_v1 AS
  SELECT id, span_id, trace_id, entity_type, entity_id, field, old_value, new_value, reason, created_at FROM runtime_state_changes;
CREATE VIEW IF NOT EXISTS telemetry_errors_v1 AS
  SELECT id, span_id, trace_id, error_type, message, recoverable, context, created_at FROM runtime_errors;

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;
