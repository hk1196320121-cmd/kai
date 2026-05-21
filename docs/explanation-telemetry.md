# How the Flight Recorder Works

The telemetry system traces every MCP tool call from request to response, recording spans, events, state changes, and errors along the way. This doc explains why it works the way it does and what trade-offs it makes.

## The problem

When an MCP tool call fails, you see an error message. But the failure might have happened deep inside a chain: the tool handler called the derivator, which called the LLM provider, which got a rate limit error, which caused the trait write to fail. Without tracing, you have to guess where the chain broke.

The same problem applies to performance. If `derive.trigger` takes 3 seconds, is it the rule matching, the LLM call, or the database write? You need timing data at each step.

## The approach

The Flight Recorder creates a **trace** for each MCP request. A trace contains **spans** (timed operations), and each span can contain **events** (discrete occurrences), **state changes** (mutations to profile data), and **errors**.

```
Trace (MCP request: derive.trigger)
  Span: mcp_tool/derive.trigger (1200ms)
    Event: cache_miss
    Span: derivation/rule_matching (45ms)
      StateChange: trait.early_riser.value 0.3 -> 0.7
    Span: llm_call/infer_traits (1100ms)
      Event: retry (429 rate limit)
    Error: LLM API error (recoverable)
```

### Span lifecycle

1. `startTrace()` creates the trace in the database and returns a handle
2. `startSpan()` creates a pending span in memory. Spans can nest via `startChild()`
3. As the span runs, `.event()`, `.stateChange()`, and `.error()` accumulate data in memory
4. `.end()` flushes the span and all its accumulated data to the database in a single transaction

### Deferred transaction writes

All span data is held in memory until the span ends. This design avoids partial writes: a span that's still running doesn't clutter the database with half-written events. The flush uses `flushBatch()`, which wraps all inserts (span + events + state changes + errors) in a single SQLite transaction.

### Why fire-and-forget

Telemetry is infrastructure, not business logic. If a telemetry write fails, the MCP tool call should still succeed. Every telemetry operation catches errors silently. The `withTrace` wrapper in `src/mcp/handlers.ts` never lets a telemetry failure propagate to the caller.

### Attribute sanitizer

All attributes passed to `.event()` and `.stateChange()` are recursively sanitized. Any key matching `api_key`, `token`, `secret`, `password`, or `credential` (case-insensitive) is replaced with `[REDACTED]` before reaching the database. This prevents accidental leakage of API keys or tokens into telemetry storage.

### The withTrace wrapper

Every MCP tool handler is wrapped with `withTrace()` (defined in `src/mcp/handlers.ts:30`). This generic wrapper handles the full trace lifecycle:

1. Start trace and root span
2. Call the handler
3. On success: end span (ok) and trace (completed)
4. On error: record the error, end span (error) and trace (error), re-throw

Individual handlers add detail spans for sub-operations. The orchestrator's planner, dispatcher, and observer each create their own spans inside the trace. The prompt genome's tournament runner and judge engine do the same.

## SQL query interface

The `telemetry.query` tool accepts read-only SQL against telemetry tables. To prevent injection (a risk since user input becomes part of the query), the store enforces:

- Only `SELECT` statements
- No semicolons (prevents multi-statement injection)
- No `UNION` (prevents exfiltration via cross-table queries)
- No comma-joins in `FROM` clauses (prevents bypassing the table allowlist)
- Only telemetry tables and views allowed (`runtime_*` and `telemetry_*_v1`)
- Results capped at 1000 rows

The comma-join guard uses a regex (`/\bFROM\s+\w+(\s+\w+)?\s*,/i`) that specifically matches `FROM table alias,` patterns without blocking commas inside function calls like `datetime('now', '-24 hours')`.

## Retention pruning

Telemetry data accumulates. To bound storage, the MCP server runs a pruning job every 24 hours that deletes traces older than a configurable retention period (default: 30 days, env var `KAI_TELEMETRY_RETENTION_DAYS`).

Pruning deletes in order: errors, state changes, events, spans, then traces. This respects foreign key constraints. Deletion is batched (1000 traces at a time) to avoid locking the database for extended periods.

## LLM-powered explain

The `telemetry.explain` tool sends aggregated stats and recent errors to an LLM with a structured prompt. It returns a summary, relevant trace IDs, and insights (claim + evidence pairs). It falls back to a stats-only summary when no LLM API key is configured.

The explain function is rate-limited to 10 calls per hour and caches results for 5 minutes. LLM failures are intentionally not cached, so transient errors don't block retries.

## Trade-offs

**In-memory pending spans** — Spans live in a `Map` until they end. This avoids partial writes but bounds memory. A `MAX_PENDING_SPANS` cap (10,000) evicts the oldest span when the limit is hit. In practice, spans end within seconds, so this cap is unlikely to trigger.

**FK toggle in flushBatch** — SQLite doesn't allow `PRAGMA foreign_keys` inside a transaction. The `flushBatch` method disables FK checks outside the transaction, then re-enables them after. This creates a brief window where FK constraints aren't enforced, which is acceptable because the data is self-consistent (child spans reference parent spans that are in the same batch).

**Read-only SQL interface** — Allowing arbitrary SQL is powerful but risky. The allowlist + injection guards are defense-in-depth. If you need to query non-telemetry tables, use the SQLite CLI directly against `~/.kai/kai.db`.

**Stats queries scan all traces** — The stats layer queries traces filtered by time window using a full scan. For high-volume deployments (millions of traces), this could become slow. The time-window approach keeps it manageable for normal usage.

## Alternatives considered

**OpenTelemetry** — A standard tracing framework would provide interoperability but requires an external collector and adds significant infrastructure. Kai runs as a single-process MCP server. The built-in recorder is self-contained.

**Log-based telemetry** — Structured logs to stderr already exist. But logs are ephemeral and don't support causal chain queries. The SQLite-backed approach gives persistent, queryable traces without external infrastructure.

## Related

- [How to Use Telemetry](howto-telemetry.md) — practical guide for debugging and monitoring
- [Database Schema Reference](reference-database.md) — V7 telemetry tables and views
- [CLI Reference](reference-cli.md) — `kai telemetry` commands
- [MCP Server Reference](reference-mcp-server.md) — telemetry.query, telemetry.trace, telemetry.explain tools
