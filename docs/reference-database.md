# Database Schema Reference

Complete reference for Kai's SQLite database: all tables, columns, constraints, indexes, and migration history.

## Connection

Default path: `$KAI_DB` or `~/.kai/kai.db`. Override with the `KAI_DB` environment variable or `kai mcp serve --db <path>`.

The database uses WAL (write-ahead logging) mode for concurrent read/write safety. Foreign keys are enabled. Busy timeout is 5000ms.

Migrations run automatically on startup. The schema is versioned from v1 to v8.

## Tables

### `schema_version`

Tracks the current database schema version.

| Column | Type | Constraints |
|--------|------|-------------|
| version | INTEGER | PRIMARY KEY |

Always contains a single row with the highest applied migration number (currently 8).

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
| event_type | TEXT | — | NOT NULL, CHECK(IN ('workspace_created','task_created','task_updated','task_completed','interaction','coldstart_answer','workspace_archived','recommendation_shown','recommendation_accepted','recommendation_rejected','task_auto_executed')) |
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

### `prompt_genes` (v6)

Prompt gene library — each gene is a reusable prompt fragment typed by function (intent, contract, adapter, example, tone).

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| task | TEXT | — | NOT NULL, CHECK(IN ('planner','derivator','observer')) |
| type | TEXT | — | NOT NULL, CHECK(IN ('intent','contract','adapter','example','tone')) |
| content | TEXT | — | NOT NULL |
| trait_bindings | TEXT | `'{}'` | NOT NULL (JSON) |
| metadata | TEXT | `'{}'` | NOT NULL (JSON) |
| created_at | TEXT | `datetime('now')` | NOT NULL |

### `prompt_genomes` (v6)

Assembled genomes — ordered collections of gene IDs for a task.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| task | TEXT | — | NOT NULL |
| gene_ids | TEXT | — | NOT NULL (JSON array of gene IDs) |
| compiler_config | TEXT | `'{}'` | NOT NULL (JSON) |
| created_at | TEXT | `datetime('now')` | NOT NULL |

### `prompt_variants` (v6)

Compiled prompt variants — the output of assembling a genome into a full prompt string. Tracks lineage via parent_variant_id.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| genome_id | TEXT | — | NOT NULL, FK → prompt_genomes(id) |
| compiled_prompt | TEXT | — | NOT NULL |
| generation | INTEGER | 1 | NOT NULL |
| parent_variant_id | TEXT | NULL | FK → prompt_variants(id) |
| mutation_type | TEXT | NULL | Seed, rephrase, adjust, etc. |
| created_at | TEXT | `datetime('now')` | NOT NULL |

### `prompt_segments` (v6)

Profile-based segments for prompt personalization. Each segment defines trait constraints that match user profiles.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| name | TEXT | — | NOT NULL |
| trait_constraints | TEXT | `'{}'` | NOT NULL (JSON) |
| description | TEXT | `''` | NOT NULL |
| created_at | TEXT | `datetime('now')` | NOT NULL |

### `prompt_eval_cases` (v6)

Test cases for tournament evaluation. Each case has an input, optional expected output, and difficulty/source classification.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| task | TEXT | — | NOT NULL |
| input | TEXT | — | NOT NULL |
| expected_output | TEXT | NULL | Optional expected result |
| difficulty | TEXT | `'medium'` | NOT NULL, CHECK(IN ('easy','medium','hard')) |
| source | TEXT | `'synthetic'` | NOT NULL, CHECK(IN ('synthetic','real','edge_case')) |
| created_at | TEXT | `datetime('now')` | NOT NULL |

### `prompt_tournaments` (v6)

Pairwise battle records between two variants, judged by LLM.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| task | TEXT | — | NOT NULL |
| variant_a_id | TEXT | — | NOT NULL, FK → prompt_variants(id) |
| variant_b_id | TEXT | — | NOT NULL, FK → prompt_variants(id) |
| eval_case_id | TEXT | — | NOT NULL, FK → prompt_eval_cases(id) |
| segment_id | TEXT | NULL | FK → prompt_segments(id) |
| model | TEXT | `'gpt-4o-mini'` | NOT NULL |
| winner | TEXT | NULL | CHECK(IN ('a','b','tie')) |
| judge_reasoning | TEXT | NULL | LLM judge explanation |
| judge_confidence | REAL | NULL | CHECK(0.0–1.0) |
| judged_at | TEXT | NULL | |
| created_at | TEXT | `datetime('now')` | NOT NULL |

### `prompt_champions` (v6)

Current champion variant per task and segment. Only one champion per task/segment pair.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| task | TEXT | — | NOT NULL |
| segment_id | TEXT | — | NOT NULL, FK → prompt_segments(id) |
| variant_id | TEXT | — | NOT NULL, FK → prompt_variants(id) |
| model | TEXT | `'gpt-4o-mini'` | NOT NULL |
| win_rate | REAL | — | NOT NULL |
| battle_count | INTEGER | — | NOT NULL |
| promoted_at | TEXT | `datetime('now')` | NOT NULL |
| previous_variant_id | TEXT | NULL | The variant this champion replaced |
| is_locked | INTEGER | 0 | NOT NULL — locked champions cannot be rolled back |

### `prompt_champion_history` (v6)

Audit trail of champion promotions and demotions.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| task | TEXT | — | NOT NULL |
| segment_id | TEXT | — | NOT NULL |
| variant_id | TEXT | — | NOT NULL |
| model | TEXT | — | NOT NULL |
| win_rate | REAL | — | NOT NULL |
| battle_count | INTEGER | — | NOT NULL |
| promoted_at | TEXT | — | NOT NULL |
| demoted_at | TEXT | NULL | |
| demotion_reason | TEXT | NULL | |

**Index:** `idx_prompt_champion_history_task` on `task`.

### `runtime_traces` (v7)

Top-level telemetry traces. Each trace represents a complete MCP request lifecycle.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| trigger | TEXT | — | NOT NULL |
| tool_name | TEXT | NULL | The MCP tool that triggered this trace |
| root_cause | TEXT | NULL | Root cause for error traces |
| started_at | TEXT | `datetime('now')` | NOT NULL |
| duration_ms | INTEGER | NULL | Duration in milliseconds |
| status | TEXT | `'running'` | NOT NULL |

**Indexes:** `idx_traces_started` on `started_at DESC`, `idx_traces_status` on `status`.

### `runtime_spans` (v7)

Individual operations within a trace. Spans can be nested via `parent_span_id`.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | TEXT | — | PRIMARY KEY |
| trace_id | TEXT | — | NOT NULL, FK → runtime_traces(id) |
| parent_span_id | TEXT | NULL | FK → runtime_spans(id) |
| operation | TEXT | — | NOT NULL |
| name | TEXT | — | NOT NULL |
| started_at | TEXT | `datetime('now')` | NOT NULL |
| duration_ms | INTEGER | NULL | Duration in milliseconds |
| status | TEXT | `'running'` | NOT NULL |
| attributes | TEXT | `'{}'` | NOT NULL (JSON) |

**Indexes:** `idx_spans_trace` on `trace_id`, `idx_spans_operation` on `operation`, `idx_spans_started` on `started_at DESC`.

### `runtime_events` (v7)

Events recorded within a span (e.g., cache hit, retry, state transition).

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | INTEGER | AUTO | PRIMARY KEY |
| span_id | TEXT | — | NOT NULL, FK → runtime_spans(id) |
| trace_id | TEXT | — | NOT NULL, FK → runtime_traces(id) |
| type | TEXT | — | NOT NULL |
| name | TEXT | — | NOT NULL |
| payload | TEXT | `'{}'` | NOT NULL (JSON) |
| created_at | TEXT | `datetime('now')` | NOT NULL |

**Indexes:** `idx_events_trace` on `trace_id`, `idx_events_span` on `span_id`, `idx_events_created` on `created_at DESC`.

### `runtime_state_changes` (v7)

State mutations recorded during a span (e.g., trait value changed, observation added).

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | INTEGER | AUTO | PRIMARY KEY |
| span_id | TEXT | — | NOT NULL, FK → runtime_spans(id) |
| trace_id | TEXT | — | NOT NULL, FK → runtime_traces(id) |
| entity_type | TEXT | — | NOT NULL |
| entity_id | TEXT | — | NOT NULL |
| field | TEXT | — | NOT NULL |
| old_value | TEXT | NULL | |
| new_value | TEXT | NULL | |
| reason | TEXT | NULL | |
| created_at | TEXT | `datetime('now')` | NOT NULL |

**Indexes:** `idx_state_changes_entity` on `(entity_type, entity_id)`, `idx_state_changes_trace` on `trace_id`, `idx_state_changes_created` on `created_at DESC`.

### `runtime_errors` (v7)

Errors recorded within a span with type, message, stack trace, and recoverability.

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | INTEGER | AUTO | PRIMARY KEY |
| span_id | TEXT | — | NOT NULL, FK → runtime_spans(id) |
| trace_id | TEXT | — | NOT NULL, FK → runtime_traces(id) |
| error_type | TEXT | — | NOT NULL |
| message | TEXT | — | NOT NULL |
| stack_trace | TEXT | NULL | |
| recoverable | INTEGER | 0 | NOT NULL (0 or 1) |
| context | TEXT | `'{}'` | NOT NULL (JSON) |
| created_at | TEXT | `datetime('now')` | NOT NULL |

**Indexes:** `idx_errors_trace` on `trace_id`, `idx_errors_created` on `created_at DESC`.

### Telemetry Views (v7)

Read-only views that expose telemetry data without internal fields. These are the tables available to `telemetry.query`.

| View | Source | Columns |
|------|--------|---------|
| `telemetry_traces_v1` | `runtime_traces` | id, trigger, tool_name, started_at, duration_ms, status |
| `telemetry_spans_v1` | `runtime_spans` | id, trace_id, parent_span_id, operation, name, started_at, duration_ms, status, attributes |
| `telemetry_events_v1` | `runtime_events` | id, span_id, trace_id, type, name, payload, created_at |
| `telemetry_state_changes_v1` | `runtime_state_changes` | id, span_id, trace_id, entity_type, entity_id, field, old_value, new_value, reason, created_at |
| `telemetry_errors_v1` | `runtime_errors` | id, span_id, trace_id, error_type, message, recoverable, context, created_at |

## Migration history

| Version | Changes |
|---------|---------|
| v1 | Initial schema: `schema_version`, `identity`, `traits`, `preferences`, `observations`. Sources: `cron_output`, `session_log`, `user_stated`, `inferred` |
| v2 | Add `mcp` to observation sources. Table rebuild with transaction-safe DDL |
| v3 | Add `corrections` table for persistent trait corrections |
| v4 | Add `workspaces`, `workspace_tasks`, `workspace_events` tables. Add `coldstart`, `workspace` to observation sources. Table rebuild with transaction |
| v5 | Add `ideas`, `planned_tasks`, `execution_results` tables. Remove source CHECK constraint (accept any string). Supports `execution_result` source |
| v6 | Add `prompt_genes`, `prompt_genomes`, `prompt_variants`, `prompt_segments`, `prompt_eval_cases`, `prompt_tournaments`, `prompt_champions`, `prompt_champion_history` tables. Prompt genome system for evolutionary prompt optimization |
| v7 | Add `runtime_traces`, `runtime_spans`, `runtime_events`, `runtime_state_changes`, `runtime_errors` tables with 10+ indexes. Add 5 telemetry views (`telemetry_*_v1`). Flight recorder telemetry system for full causal chain tracing |
| v8 | Extend `workspace_events` event_type CHECK with `recommendation_shown`, `recommendation_accepted`, `recommendation_rejected`, `task_auto_executed`. Table rebuild with transaction-safe DDL |

All migrations use `PRAGMA foreign_keys = OFF` during table rebuilds, then re-enable. Transactions wrap destructive operations. `PRAGMA integrity_check` runs after each rebuild migration.

## File location

The database is a single SQLite file at `~/.kai/kai.db` (or `$KAI_DB`). No other files are needed. The WAL mode creates `kai.db-wal` and `kai.db-shm` alongside the main file during operation.

## Related

- [CLI Reference](reference-cli.md) — commands that read and write this data
- [MCP Server Reference](reference-mcp-server.md) — API that queries these tables
- [How to Configure Kai](howto-configure.md) — setting `KAI_DB` and other environment variables
