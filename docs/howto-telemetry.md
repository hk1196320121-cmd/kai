# How to Use Telemetry

Debug failures, monitor performance, and query trace data from the Flight Recorder.

## Prerequisites

- Kai MCP server running (`kai mcp serve`) or CLI commands available
- Database with telemetry data (traces accumulate automatically as you use Kai)

## Check system health

Get a quick summary of traces, errors, and latency:

```bash
kai telemetry health
```

Output shows total traces, error count, error rate, P95 latency, and top operations. If error rate is above 5%, investigate with the errors command.

## Find recent errors

List the most recent telemetry errors:

```bash
kai telemetry errors
kai telemetry errors --last 10    # Last 10 errors
kai telemetry errors --json       # JSON output for scripting
```

Each error shows its type (e.g., `LLM_API_error`, `DatabaseError`), message, and whether it's recoverable. Non-recoverable errors are the ones that caused tool calls to fail.

## Inspect a failing trace

When an MCP tool call fails, check the trace to see where in the causal chain it broke:

```bash
kai telemetry trace <trace-id>
```

Output shows:
- **Spans** — each operation in the request, with duration and status
- **Events** — discrete occurrences (cache hits, retries, state transitions)
- **State changes** — what data was mutated (e.g., `trait.early_riser.value 0.3 -> 0.7`)
- **Errors** — what went wrong, with type and message

Look for the first span with `status: error`. That's where the failure started. Nested spans show the propagation path.

### Find a trace ID

If you don't have a trace ID, query for recent error traces:

```bash
kai telemetry query "SELECT id, tool_name, started_at, duration_ms FROM runtime_traces WHERE status = 'error' ORDER BY started_at DESC LIMIT 5"
```

## Query telemetry data with SQL

Run SELECT queries against telemetry tables and views:

```bash
# Find slow traces (>1 second)
kai telemetry query "SELECT id, tool_name, duration_ms FROM runtime_traces WHERE duration_ms > 1000 ORDER BY duration_ms DESC LIMIT 10"

# Count traces by tool
kai telemetry query "SELECT tool_name, COUNT(*) as count FROM runtime_traces GROUP BY tool_name ORDER BY count DESC"

# Find error patterns
kai telemetry query "SELECT error_type, message, COUNT(*) as count FROM runtime_errors GROUP BY error_type, message ORDER BY count DESC LIMIT 10"

# Recent state changes to traits
kai telemetry query "SELECT entity_id, field, old_value, new_value, reason FROM runtime_state_changes WHERE entity_type = 'trait' ORDER BY created_at DESC LIMIT 20"
```

Allowed tables: `runtime_traces`, `runtime_spans`, `runtime_events`, `runtime_state_changes`, `runtime_errors`, and the `telemetry_*_v1` views. Results capped at 1000 rows.

### Output formats

```bash
kai telemetry query "SELECT * FROM runtime_traces LIMIT 5"              # JSON (default)
kai telemetry query "SELECT * FROM runtime_traces LIMIT 5" --format table  # Tab-separated
```

## Get an LLM analysis

Ask a natural language question about your telemetry data:

```bash
kai telemetry explain "What's causing the most errors?"
kai telemetry explain "Why is derive.trigger slow?"
```

This sends aggregated stats and recent errors to an LLM, which returns a summary and insights with evidence. Falls back to a stats-only summary if no `LLM_API_KEY` is configured.

Rate limited to 10 calls per hour. Results cached for 5 minutes.

## Use MCP tools from an AI agent

If you're connected via MCP (Claude Desktop, Cursor, etc.), use the telemetry tools:

```
telemetry.query  → Run SQL against telemetry views
telemetry.trace  → Get full causal chain for a trace (includes suggested_actions for errors)
telemetry.explain → Natural language analysis
```

Resources available:
- `kai://telemetry/health` — current stats
- `kai://telemetry/recent-errors` — last 50 errors
- `kai://telemetry/trace/{traceId}` — full trace detail

## Configure retention

Telemetry data is automatically pruned after 30 days. Change the retention period:

```bash
export KAI_TELEMETRY_RETENTION_DAYS=7    # Keep only 7 days
```

Pruning runs every 24 hours while the MCP server is running.

## Troubleshooting

**"Table is not a telemetry table"** — You queried a non-telemetry table. Only `runtime_*` and `telemetry_*_v1` tables/views are allowed. Use `sqlite3 ~/.kai/kai.db` directly for full access.

**"Semicolons are not allowed"** — Remove the trailing semicolon from your query.

**"Comma-separated tables are not allowed"** — Use explicit `JOIN` syntax instead of `FROM table1, table2`.

**"Rate limit exceeded"** — `telemetry.explain` allows 10 calls per hour. Wait and retry, or check health/stats directly with `kai telemetry health`.

**No telemetry data** — Traces are only created when the MCP server is running. CLI commands like `kai profile read` do not create traces. Start the server with `kai mcp serve` and make MCP tool calls to generate telemetry data.

## Related

- [How the Flight Recorder Works](explanation-telemetry.md) — design decisions and trade-offs
- [CLI Reference](reference-cli.md) — full `kai telemetry` command reference
- [Database Schema Reference](reference-database.md) — V7 telemetry tables and views
- [MCP Server Reference](reference-mcp-server.md) — telemetry tools and resources
