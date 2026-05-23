# MCP Server Reference

Complete API reference for Kai's Model Context Protocol server. Covers all 19 tools (5 profile + 8 orchestrator + 3 prompt + 3 telemetry), 12 resources, schemas, error handling, and behavior.

## Starting the Server

```bash
kai mcp serve                  # Default database: ~/.kai/kai.db
kai mcp serve --db /path/db    # Custom database path
```

The server uses stdio transport. It reads JSON-RPC from stdin and writes to stdout. Structured logs go to stderr in JSON-line format.

## Tools

### profile.read

Reads user profile data. Returns different shapes depending on scope.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| scope | `"identity"` \| `"traits"` \| `"summary"` \| `"full"` | Yes | Which data to return |
| dimensions | `string[]` | No | Filter traits to these dimensions (only with `scope: "traits"`) |

**Scopes:**

| Scope | Returns |
|-------|---------|
| `identity` | `{ name, role, location, timezone, communication_style, interests }`. Omits internal fields (id, timestamps). |
| `traits` | Array of `{ dimension, value, confidence, source, timestamp }`. Optional `dimensions` filter. |
| `summary` | `{ identity, topTraits: Trait[] }`. Top 5 traits sorted by confidence. |
| `full` | `{ identity, traits, observations, preferences }`. Complete profile snapshot. |

**Error responses:** Returns `{ error: string }` for database failures. Returns empty arrays/objects for profiles with no data — never throws.

### profile.why

Explains why a trait has its current value. Shows the provenance chain: contributing observations, matched rules, and derived reasoning.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| dimension | `string` | Yes | Trait dimension to explain (e.g., `"early_riser"`) |

**Returns:**

```json
{
  "dimension": "early_riser",
  "value": 0.8,
  "confidence": 7,
  "source": "observed",
  "relatedObservations": [
    { "id": 42, "text": "...", "confidence": 8, "timestamp": "..." }
  ],
  "ruleMatchedObservations": [
    { "id": 15, "text": "...", "rule": "early_riser" }
  ]
}
```

Returns `null` if dimension doesn't exist or has no trait.

### observe.submit

Submits a single observation. Deduplicated by SHA-256 hash of `text + tags + context`.

**Input schema:**

| Parameter | Type | Required | Constraints | Description |
|-----------|------|----------|-------------|-------------|
| text | `string` | Yes | 1–10240 chars | Observation content |
| sourceTool | `string` | Yes | 1–64 chars | Name of the submitting tool. Colons (`:`) replaced with `_`. |
| confidence | `number` | No | 0–1 (MCP scale) | Automatically converted to internal 1–10 scale |
| tags | `string[]` | No | — | Category labels for filtering |
| context | `string` | No | — | Extra context included in dedup hash |

**Rate limit:** 60 requests per 60-second window. Returns error on exceed.

**Dedup:** Hash namespace: `mcp:{sourceTool}:{sha256(text+tags+context)}`. If a duplicate exists, returns the existing observation with `duplicate: true`.

**Returns:** Stored observation with `id`, `key`, `timestamp`.

### observe.batch

Submits up to 50 observations in one call. Same schema and dedup as `observe.submit`.

**Input schema:**

| Parameter | Type | Required | Constraints | Description |
|-----------|------|----------|-------------|-------------|
| sourceTool | `string` | Yes | 1–64 chars | Tool name for all observations |
| observations | `Array<{ text, confidence?, tags?, context? }>` | Yes | 1–50 items | Observation batch |

**Returns:** Array of stored observations or duplicate notices.

### derive.trigger

Triggers trait derivation from collected observations.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| method | `"rules"` \| `"llm"` \| `"both"` | Yes | Derivation method |

**Methods:**

| Method | Behavior |
|--------|----------|
| `rules` | Applies 6 built-in pattern rules. Fast, deterministic. |
| `llm` | Uses LLM to infer traits. Requires `OPENAI_API_KEY` or compatible endpoint configured. Falls back gracefully on failure. |
| `both` | Runs rules first, then LLM. Merges results. |

**Derivation rules:**

*MCP / cron rules:*

| Rule | Dimension | Matches | Derives |
|------|-----------|---------|---------|
| Early riser | `early_riser` | Cron patterns showing morning (5–9 AM) activity | value 0–1, confidence based on match count |
| Tinkerer | `tinkerer` | Experimentation/tool usage (accepts `mcp:` keys) | value 0–1, confidence based on diversity |
| Consistent user | `consistent_user` | Regular daily usage patterns | value 0–1, confidence based on streak |
| Detail oriented | `detail_oriented` | MCP observations showing thorough behavior | value 0–1, confidence based on text length |
| Scope appetite | `scope_appetite` | Observations showing broad exploration | value 0–1, confidence based on topic diversity |
| Risk tolerance | `risk_tolerance` | Observations showing risk-taking behavior | value 0–1, confidence based on risk indicators |

*Coldstart signal rules (deriveFromValues):*

| Rule | Dimension | Signal key | Source |
|------|-----------|------------|--------|
| Planning style | `planning_style` | `coldstart:planning_style` | Interview answer |
| Schedule rhythm | `schedule_rhythm` | `coldstart:schedule_rhythm` | Interview answer |
| Output shape | `preferred_output_shape` | `coldstart:preferred_output_shape` | Interview answer |
| Disliked behavior | `disliked_behavior` | `coldstart:disliked_behavior` | Interview answer |
| Risk tolerance | `risk_tolerance` | `coldstart:risk_tolerance` | Interview answer |
| Autonomy | `autonomy` | `coldstart:autonomy` | Interview answer |
| Domain context | `domain_context` | `coldstart:domain_context` | Interview answer |

*Coldstart git/aggregate rules:*

| Rule | Dimension | Signal key | Source |
|------|-----------|------------|--------|
| Detail level | `detail_oriented` | `coldstart:signal.detail_level` | Self-assessment |
| Communication style | `comm_style` | `coldstart:signal.comm_style` | Self-assessment |
| Domain context | `domain_context` | `coldstart:signal.domain` | Self-assessment |
| Output shape | `preferred_output_shape` | `coldstart:preferred_output_shape` | Self-assessment |
| Commit times | `early_riser` | `coldstart:git.commit_time_distribution` | Git history |
| Commit messages | `detail_oriented` | `coldstart:git.commit_message_length` | Git history |
| Branch patterns | `scope_appetite` | `coldstart:git.branch_pattern` | Git history |

**Skips:** Dimensions with active corrections are never re-derived.

**Returns:** Array of `{ dimension, value, confidence, source }` for newly derived traits.

## Orchestrator Tools (8)

Tools for the idea-to-execution pipeline: submit ideas, decompose them into tasks, schedule and dispatch work, observe results, and re-plan when behavioral traits change.

### kai_idea_submit

Submit a new idea for planning and execution.

**Input schema:**

| Parameter | Type | Required | Constraints | Description |
|-----------|------|----------|-------------|-------------|
| title | `string` | Yes | 1–200 chars | Idea title |
| description | `string` | No | 1–5000 chars | Detailed description |
| domain | `"coding"` \| `"writing"` \| `"research"` \| `"creative"` \| `"management"` \| `"general"` | No | Default: `general` | Idea domain for context |
| priority | `"low"` \| `"medium"` \| `"high"` \| `"critical"` | No | Default: `medium` | Idea priority |
| deadline | `string` | No | ISO date | Optional deadline |
| workspace_id | `string` | No | — | Existing workspace ID (auto-created if omitted) |

**Returns:** Created idea with `id`, `title`, `status`, `createdAt`.

### kai_idea_plan

Decompose an idea into a plan of tasks. Uses LLM-powered decomposition that adapts to the user's behavioral profile (e.g., morning tasks for early risers, shorter tasks for detail-oriented users).

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| idea_id | `string` | Yes | ID from `kai_idea_submit` |

**Returns:** Plan with array of planned tasks. Each task has `title`, `description`, `scheduledFor` (ISO timestamp), and `agentHint` (target agent name). LLM-generated agent names are validated against an allowlist.

### kai_plan_approve

Approve a plan, scheduling its tasks for execution. Optionally override specific task fields.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| idea_id | `string` | Yes | Idea whose plan to approve |
| task_modifications | `Array<{ task_id, action, field, value }>` | No | Override fields for specific tasks. Allowed fields: `title`, `prompt`, `cron_schedule`, `agent`, `type`. Cron values validated against format regex. |

**Returns:** Approved tasks with scheduled times and dispatch status.

### kai_task_execute

Dispatch a specific task to the agent bridge for execution.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| task_id | `string` | Yes | Task to execute |

**Returns:** Execution result with `status`, `exitCode`, `output`.

### kai_idea_pause

Pause an active idea and all its pending tasks. Completed tasks are unaffected.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| idea_id | `string` | Yes | Idea to pause |

**Returns:** Updated idea with `status: "paused"`.

### kai_execution_status

Check execution status for all tasks belonging to an idea.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| idea_id | `string` | Yes | Idea to check |
| task_id | `string` | No | Filter to a specific task |
| feedback | `string` | No | Max 2000 chars | User feedback (becomes profile observation) |

**Returns:** Array of tasks with execution status (`pending`, `running`, `completed`, `failed`), exit codes, and timestamps.

### kai_replan

Re-plan an idea after closed-loop feedback. Use when the closed-loop engine detects significant trait changes that warrant schedule adjustments, or when the user wants a fresh decomposition.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| idea_id | `string` | Yes | Idea to re-plan |

**Returns:** New plan replacing the previous one, with updated tasks reflecting the current profile state.

### kai_work_recommend

Get task recommendations based on the user's behavioral profile traits. The recommendation engine matches task templates against the user's trait dimensions, scoring each template by alignment and applying a domain bonus.

**Input schema:**

| Parameter | Type | Required | Constraints | Description |
|-----------|------|----------|-------------|-------------|
| domain | `"coding"` \| `"writing"` \| `"research"` \| `"creative"` \| `"management"` \| `"general"` | No | Default: `general` | Filter recommendations by domain |
| limit | `number` | No | 1–5, default: 3 | Number of recommendations to return |

**Returns:** Array of recommendation objects, each with:
- `title` — task template title
- `domain` — matching domain
- `traitAlignment` — alignment score (0–1)
- `explanation` — why this task fits the user's profile
- `traitTargets` — trait dimensions used for matching and feedback loop

## Prompt Genome Tools (3)

Tools for the prompt optimization system: compile prompts from gene libraries, check champion variants, and run evolutionary A/B testing.

### prompt.compile

Compile a prompt for a given task using the current genome. The compiler selects the best gene variants for each type (intent, contract, adapter, example, tone) and assembles them into a complete prompt tailored to the user's profile segment.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| task | `"planner"` \| `"derivator"` \| `"observer"` | Yes | Task to compile prompt for |

**Returns:** Object with `task`, `segment`, `gene_count`, `cached`, and `prompt_length`.

### prompt.champion

Get the current champion variant for a task and optional segment. Champions are the best-performing variants from tournament battles.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| task | `"planner"` \| `"derivator"` \| `"observer"` | Yes | Task to get champion for |
| segment | `string` | No | Segment ID (default: `"default"`) |

**Returns:** Champion object with variant ID, model, win rate, battle count, promotion date, and lock status. Returns `{ champion: null }` if no champion exists.

### prompt.evolve

Run evolutionary optimization for a task's prompt. Generates new variants via LLM mutations, runs pairwise tournament battles with LLM-as-judge evaluation, and promotes the winner as champion if it outperforms the current one.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| task | `"planner"` \| `"derivator"` \| `"observer"` | Yes | Task to evolve |
| rounds | `number` | No | Number of evolution rounds (default: 1) |
| auto_approve | `boolean` | No | Auto-approve champion promotion (default: false) |

**Returns:** Evolution result with `rounds_completed`, `battles_run`, `champion_promoted`, `champion_variant_id`, and `previous_champion_variant_id`.

## Telemetry Tools (3)

Tools for the flight recorder telemetry system: query trace data, inspect causal chains, and analyze performance with LLM-powered explanations.

### telemetry.query

Run a SQL query against telemetry views. Read-only with strict table allowlist and injection protection.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| sql | `string` | Yes | SQL query (must start with SELECT, semicolons blocked) |

**Allowed tables:** `telemetry_traces_v1`, `telemetry_spans_v1`, `telemetry_events_v1`, `telemetry_state_changes_v1`, `telemetry_errors_v1`, `runtime_traces`, `runtime_spans`, `runtime_events`, `runtime_state_changes`, `runtime_errors`. Results capped at 1000 rows. UNION, comma-joins, and non-telemetry tables are blocked.

**Returns:** Array of result rows as JSON objects.

### telemetry.trace

Show the full causal chain for a trace: all spans, events, state changes, errors, and suggested actions for failures.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| trace_id | `string` | Yes | Trace ID to inspect |

**Returns:**

```json
{
  "trace": { "id", "trigger", "tool_name", "status", "started_at", "duration_ms" },
  "spans": [{ "id", "operation", "name", "status", "duration_ms", "events", "stateChanges", "errors" }],
  "suggestedActions": ["string"]
}
```

Spans are sorted by start time. Each span includes nested events, state changes, and errors. `suggestedActions` provides recovery guidance when errors are present.

### telemetry.explain

Natural language analysis of telemetry data. Uses LLM to answer questions about traces, errors, and performance patterns.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| question | `string` | Yes | Question about telemetry data |

**Rate limit:** 10 calls per hour. Results cached for 5 minutes.

**Returns:**

```json
{
  "summary": "string",
  "traces": ["trace_id"],
  "insights": [{ "claim": "string", "evidence": "string" }]
}
```

Falls back to a stats-only summary when no LLM API key is configured. LLM failures are not cached to allow retry.

## Resources

Read-only profile access. All return `application/json`.

### kai://profile/identity

User identity fields (name, role, location, timezone, communication_style, interests).

### kai://profile/traits

All traits with dimension, value (0–1 MCP scale), confidence (1–10), source, and timestamp.

### kai://profile/traits/{dimension}

Template resource. Replace `{dimension}` with a trait name (e.g., `kai://profile/traits/early_riser`). Returns single trait or 404.

### kai://profile/observations/recent

50 most recent observations, newest first. Includes text, source, type, confidence, tags.

### kai://profile/summary

Profile summary: identity fields + top 5 traits sorted by confidence.

### kai://system/health

System health check. Returns:

```json
{
  "status": "ok",
  "database": {
    "path": "~/.kai/kai.db",
    "sizeBytes": 45056,
    "integrity": "ok",
    "observationCount": 234,
    "traitCount": 8
  }
}
```

### kai://prompt/{task}

Compiled prompt for a task. Returns a JSON object with the task name, segment, gene count, and a 200-character prompt preview.

**Template:** Replace `{task}` with `planner`, `derivator`, or `observer`.

### kai://prompt/champion/{task}

Current champion variant for a task's default segment. Returns champion metadata or `{ champion: null }` if no champion exists.

**Template:** Replace `{task}` with `planner`, `derivator`, or `observer`.

### kai://prompt/evolution-history/{task}

Champion promotion history for a task. Returns an array of champion history entries showing how the champion changed over time.

**Template:** Replace `{task}` with `planner`, `derivator`, or `observer`.

### kai://telemetry/trace/{traceId}

Full causal chain for a specific trace. Returns the trace, all spans with nested events/state changes/errors, and suggested actions.

**Template:** Replace `{traceId}` with a valid trace ID.

### kai://telemetry/recent-errors

Recent telemetry errors. Returns the 20 most recent errors with type, message, recoverability, and timestamp.

### kai://telemetry/health

Telemetry system health stats. Returns:

```json
{
  "status": "ok",
  "traceCount": 42,
  "errorCount": 3,
  "errorRate": 0.071,
  "p95LatencyMs": 150,
  "retentionDays": 30
}
```

## Confidence Scale Conversion

| MCP (0–1) | Internal (1–10) | Meaning |
|-----------|-----------------|---------|
| 0.0 | 1 | Very low |
| 0.22 | 3 | Low |
| 0.44 | 5 | Moderate |
| 0.67 | 7 | High |
| 0.89 | 9 | Very high |
| 1.0 | 10 | Certain |

Formula: `internal = round(mcp * 9) + 1`. Reverse: `mcp = (internal - 1) / 9`.

## Error Handling

All tools return `{ error: string }` on failure. Common errors:

| Error | Cause |
|-------|-------|
| Rate limit exceeded | More than 60 `observe.submit` calls per minute |
| LLM not configured | `derive.trigger` with `llm` or `both` but no API key |
| Dimension not found | `profile.why` with unknown dimension |
| Idea not found | Orchestrator tool with invalid idea ID |
| Task not found | `kai_task_execute` with invalid task ID |
| Idea not active | `kai_idea_pause` on idea not in active state |
| Plan not found | `kai_plan_approve` on idea with no plan |
| Database error | SQLite issues (locked, corrupt, disk full) |

Logs go to stderr in JSON-line format: `{ ts, msg, data }`.
