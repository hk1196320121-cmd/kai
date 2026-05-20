# Database Schema Reference

Complete reference for Kai's SQLite database: all tables, columns, constraints, indexes, and migration history.

## Connection

Default path: `$KAI_DB` or `~/.kai/kai.db`. Override with the `KAI_DB` environment variable or `kai mcp serve --db <path>`.

The database uses WAL (write-ahead logging) mode for concurrent read/write safety. Foreign keys are enabled. Busy timeout is 5000ms.

Migrations run automatically on startup. The schema is versioned from v1 to v5.

## Tables

### `schema_version`

Tracks the current database schema version.

| Column | Type | Constraints |
|--------|------|-------------|
| version | INTEGER | PRIMARY KEY |

Always contains a single row with the highest applied migration number (currently 5).

### `identity`

Stores the user's identity fields. Single row.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| name | TEXT | `''` | NOT NULL |
| role | TEXT | `''` | NOT NULL |
| goals | TEXT | `'[]'` | NOT NULL (JSON array) |
| expertise_areas | TEXT | `'[]'` | NOT NULL (JSON array) |
| learning_interests | TEXT | `'[]'` | NOT NULL (JSON array) |
| work_context | TEXT | `''` | NOT NULL |
| communication_style | TEXT | `''` | NOT NULL |
| created_at | TEXT | `datetime('now')` | NOT NULL |
| updated_at | TEXT | `datetime('now')` | NOT NULL |

### `traits`

Behavioral traits derived from observations. One trait per dimension (UNIQUE constraint on `dimension`).

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| dimension | TEXT | — | NOT NULL, UNIQUE |
| value | REAL | — | NOT NULL, CHECK(0.0 <= value <= 1.0) |
| confidence | INTEGER | 1 | NOT NULL, CHECK(1 <= confidence <= 10) |
| source | TEXT | — | NOT NULL, CHECK(IN ('declared','observed','inferred','cross-model')) |
| reasoning | TEXT | `''` | NOT NULL |
| updated_at | TEXT | `datetime('now')` | NOT NULL |

**Index:** `idx_traits_dimension` on `dimension`.

### `observations`

Behavioral observations collected from various sources. The central data store for the profile engine.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | INTEGER | AUTO | PRIMARY KEY |
| type | TEXT | — | NOT NULL, CHECK(IN ('behavior','preference','feedback','context','signal')) |
| key | TEXT | — | NOT NULL |
| value | TEXT | `'{}'` | NOT NULL (JSON) |
| confidence | INTEGER | 5 | NOT NULL, CHECK(1 <= confidence <= 10) |
| source | TEXT | — | NOT NULL |
| provenance | TEXT | `'{}'` | NOT NULL (JSON) |
| ts | TEXT | `datetime('now')` | NOT NULL |

Source values by schema version: v1 (`cron_output`, `session_log`, `user_stated`, `inferred`), v2 (added `mcp`), v4 (added `coldstart`, `workspace`), v5 (removed CHECK constraint — accepts any string, added `execution_result`).

**Indexes:** `idx_observations_type`, `idx_observations_key`, `idx_observations_ts`.

### `corrections` (v3)

Records trait corrections to prevent re-derivation. One correction per dimension.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| dimension | TEXT | — | NOT NULL, UNIQUE |
| reason | TEXT | `''` | NOT NULL |
| corrected_at | TEXT | `datetime('now')` | NOT NULL |

### `preferences`

Key-value preference store.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| key | TEXT | — | NOT NULL, UNIQUE |
| value | TEXT | — | NOT NULL |
| source | TEXT | — | NOT NULL, CHECK(IN ('user-stated','inferred')) |
| created_at | TEXT | `datetime('now')` | NOT NULL |

### `workspaces` (v4)

Cold start and work tracking workspaces.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| name | TEXT | — | NOT NULL |
| description | TEXT | `''` | NOT NULL |
| status | TEXT | `'active'` | NOT NULL, CHECK(IN ('active','archived','completed')) |
| context | TEXT | `'{}'` | NOT NULL (JSON: `profile_snapshot`, `coldstart_completed_at`) |
| created_at | TEXT | `datetime('now')` | NOT NULL |
| updated_at | TEXT | `datetime('now')` | NOT NULL |

### `workspace_tasks` (v4)

Tasks within workspaces.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| workspace_id | TEXT | — | NOT NULL, FK → workspaces(id) ON DELETE CASCADE |
| title | TEXT | — | NOT NULL |
| description | TEXT | `''` | NOT NULL |
| status | TEXT | `'pending'` | NOT NULL, CHECK(IN ('pending','in_progress','completed','cancelled')) |
| metadata | TEXT | `'{}'` | NOT NULL (JSON) |
| created_at | TEXT | `datetime('now')` | NOT NULL |
| updated_at | TEXT | `datetime('now')` | NOT NULL |

### `workspace_events` (v4)

Events within workspaces, used by the event bus to generate observations.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | INTEGER | AUTO | PRIMARY KEY |
| workspace_id | TEXT | — | NOT NULL, FK → workspaces(id) ON DELETE CASCADE |
| task_id | TEXT | NULL | FK → workspace_tasks(id) ON DELETE SET NULL |
| event_type | TEXT | — | NOT NULL, CHECK(IN ('workspace_created','task_created','task_updated','task_completed','interaction','coldstart_answer','workspace_archived')) |
| payload | TEXT | `'{}'` | NOT NULL (JSON) |
| created_at | TEXT | `datetime('now')` | NOT NULL |

**Indexes:** `idx_workspace_events_type`, `idx_workspace_events_workspace`.

### `ideas` (v5)

Orchestrator ideas for planning and execution.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| title | TEXT | — | NOT NULL |
| description | TEXT | — | NOT NULL |
| domain | TEXT | `'general'` | NOT NULL |
| priority | TEXT | `'medium'` | NOT NULL |
| deadline | TEXT | NULL | Optional ISO date |
| workspace_id | TEXT | — | NOT NULL |
| status | TEXT | `'draft'` | NOT NULL |
| created_at | TEXT | `datetime('now')` | NOT NULL |
| updated_at | TEXT | `datetime('now')` | NOT NULL |

**Status flow:** `draft` → `planned` → `executing` → `completed` / `paused`.

**Indexes:** `idx_ideas_status`, `idx_ideas_workspace`.

### `planned_tasks` (v5)

Tasks decomposed from ideas by the planner.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| idea_id | TEXT | — | NOT NULL, FK → ideas(id) ON DELETE CASCADE |
| workspace_id | TEXT | — | NOT NULL |
| title | TEXT | — | NOT NULL |
| description | TEXT | — | NOT NULL |
| type | TEXT | `'one_off'` | NOT NULL |
| cron_schedule | TEXT | NULL | 5-field cron format |
| cron_prompt | TEXT | NULL | Prompt for cron execution |
| agent | TEXT | `'hermes'` | NOT NULL |
| prompt | TEXT | — | NOT NULL |
| decomposition_rationale | TEXT | `''` | NOT NULL |
| scheduling_rationale | TEXT | `''` | NOT NULL |
| status | TEXT | `'pending'` | NOT NULL |
| retry_count | INTEGER | 0 | NOT NULL |
| max_retries | INTEGER | 2 | NOT NULL |
| created_at | TEXT | `datetime('now')` | NOT NULL |
| updated_at | TEXT | `datetime('now')` | NOT NULL |

**Status flow:** `pending` → `scheduled` → `executing` → `completed` / `failed` / `paused`.

**Indexes:** `idx_planned_tasks_idea`, `idx_planned_tasks_status`.

### `execution_results` (v5)

Results from task execution.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | INTEGER | AUTO | PRIMARY KEY |
| task_id | TEXT | — | NOT NULL, FK → planned_tasks(id) ON DELETE CASCADE |
| agent | TEXT | — | NOT NULL |
| success | INTEGER | — | NOT NULL, CHECK(IN (0, 1)) |
| output | TEXT | `''` | NOT NULL |
| duration_ms | INTEGER | NULL | Execution duration |
| user_feedback | TEXT | NULL | Optional user feedback |
| completed_at | TEXT | `datetime('now')` | NOT NULL |

**Index:** `idx_execution_results_task`.

## Migration history

| Version | Changes |
|---------|---------|
| v1 | Initial schema: `schema_version`, `identity`, `traits`, `preferences`, `observations`. Sources: `cron_output`, `session_log`, `user_stated`, `inferred` |
| v2 | Add `mcp` to observation sources. Table rebuild with transaction-safe DDL |
| v3 | Add `corrections` table for persistent trait corrections |
| v4 | Add `workspaces`, `workspace_tasks`, `workspace_events` tables. Add `coldstart`, `workspace` to observation sources. Table rebuild with transaction |
| v5 | Add `ideas`, `planned_tasks`, `execution_results` tables. Remove source CHECK constraint (accept any string). Supports `execution_result` source |

All migrations use `PRAGMA foreign_keys = OFF` during table rebuilds, then re-enable. Transactions wrap destructive operations. `PRAGMA integrity_check` runs after each rebuild migration.

## File location

The database is a single SQLite file at `~/.kai/kai.db` (or `$KAI_DB`). No other files are needed. The WAL mode creates `kai.db-wal` and `kai.db-shm` alongside the main file during operation.

## Related

- [CLI Reference](reference-cli.md) — commands that read and write this data
- [MCP Server Reference](reference-mcp-server.md) — API that queries these tables
- [How to Configure Kai](howto-configure.md) — setting `KAI_DB` and other environment variables
