export const MIGRATION_V3 = `
CREATE TABLE IF NOT EXISTS corrections (
  dimension TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  corrected_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(dimension)
);
`;
