# How the Module Decomposition Pattern Works

Why Kai splits large files into domain sub-modules with thin facades, and how to navigate the result.

## The problem

As Kai grew, three files crossed the threshold where reading them became a cognitive burden:

- `mcp/handlers.ts` (384 lines) — 5 profile tool handlers plus rate limiting, dedup, and JSON formatting
- `mcp/orchestrator-handlers.ts` (324 lines) — 7 orchestrator tool handlers plus planner/scheduler/bridge wiring
- `core/profile/derivator.ts` (523 lines) — 20 derivation rules, LLM inference, and orchestration logic

Each file mixed concerns. `handlers.ts` had rate limiting logic next to dedup logic next to profile read logic. `derivator.ts` interleaved rule definitions with the derivation loop with LLM prompt construction. A contributor touching `observe.submit` had to scan past 300 lines of unrelated handlers.

Monoliths also make code review harder. A PR that changes `observe.batch` shows up as a diff in a 384-line file, making it harder to assess blast radius.

## The approach

Each monolith was decomposed using the same three-part pattern:

1. **Thin facade** — the original file shrinks to 20-50 lines: imports and a single registration function that wires dependencies and delegates to domain sub-files
2. **Domain sub-files** — each file owns one coherent domain, receives dependencies via a typed `deps` object
3. **Shared utilities** — helpers duplicated across handlers (`textContent`, `withTrace`, `safeJsonParse`) extracted to `mcp/utils.ts`

### Before and after

**`handlers.ts` (384 → 21 lines)**

```
Before:
  handlers.ts        384 lines — 5 tool handlers + rate limit + dedup + JSON formatting

After:
  handlers.ts         21 lines — thin facade, wires deps, delegates
  handlers/
    profile.ts        144 lines — profile.read + profile.why
    observe.ts        162 lines — observe.submit + observe.batch + rate limiting
    derive.ts          92 lines — derive.trigger
```

**`orchestrator-handlers.ts` (324 → 52 lines)**

```
Before:
  orchestrator-handlers.ts  324 lines — 7 tool handlers + planner/scheduler wiring

After:
  orchestrator-handlers.ts  52 lines — thin facade, wires deps, delegates
  orchestrator/
    ideas.ts               162 lines — kai_idea_submit, kai_idea_plan, kai_idea_pause, kai_replan
    tasks.ts               104 lines — kai_task_execute, kai_execution_status
    planning.ts             95 lines — kai_plan_approve
    utils.ts                10 lines — shared types/constants
```

**`derivator.ts` (523 → 118 lines)**

```
Before:
  derivator.ts        523 lines — 20 rule definitions + derivation loop + LLM prompt + inference

After:
  derivator.ts        118 lines — thin facade, derivation loop only
  rules.ts            424 lines — 20 derivation rule definitions + Rule interface
  llm-derive.ts        99 lines — LLM-based trait inference logic
```

### The deps pattern

Domain sub-files don't import their dependencies directly. Instead, the facade creates shared instances and passes them via a typed object:

```typescript
// handlers.ts (facade)
export function registerHandlers(server, db, telemetry) {
  const engine = new ProfileEngine(db);
  const provenance = new ProvenanceEngine(engine);

  registerProfileHandlers(server, { engine, provenance, telemetry });
  registerObserveHandlers(server, { engine, telemetry });
  registerDeriveHandlers(server, { engine, db, telemetry });
}

// handlers/observe.ts (domain file)
interface ObserveDeps {
  engine: ProfileEngine;
  telemetry: TelemetryRecorder | null;
}

export function registerObserveHandlers(server: McpServer, deps: ObserveDeps) {
  // handlers only use deps.engine and deps.telemetry
}
```

This avoids constructor parameter explosion (7+ args in the old orchestrator-handlers) and makes each domain file's dependency surface explicit: look at the interface to see exactly what it needs.

### The declarative registry (migrations only)

The database migration extraction uses a different variant: a declarative array with import-time validation.

```typescript
// db/migrations/index.ts
export const MIGRATIONS: Migration[] = [
  { version: 1, sql: MIGRATION_V1 },
  { version: 2, sql: MIGRATION_V2 },
  // ... through v8
  { version: 8, sql: MIGRATION_V8, selfBumps: true },
];

// Import-time assertion: versions must be sequential 1..N
for (let i = 0; i < MIGRATIONS.length; i++) {
  if (MIGRATIONS[i].version !== i + 1) {
    throw new Error(`Migration ordering violation: ...`);
  }
}

// Cross-validate selfBumps flag against actual SQL content
for (const m of MIGRATIONS) {
  const hasBump = m.sql.includes("INSERT OR REPLACE INTO schema_version");
  if (m.selfBumps && !hasBump) throw new Error(`...claims selfBumps but doesn't bump`);
  if (!m.selfBumps && hasBump) throw new Error(`...bumps but selfBumps not set`);
}
```

The validation runs at module load time, not at migration time. If someone reorders the array or mislabels a flag, the process crashes immediately on startup with a clear error message, rather than silently corrupting the schema later.

## Trade-offs

**What this costs:**
- **More files to navigate.** A contributor looking for "how does observe.submit work?" now needs to know to look in `handlers/observe.ts` instead of `handlers.ts`. The facade file tells you where to go (it's just imports and delegation).
- **Slightly more indirection.** Tracing a handler call goes facade → deps wiring → domain file instead of directly to the handler. The cost is one extra file open.

**What this gains:**
- **Domain-level code review.** A PR touching observation logic only changes `handlers/observe.ts`. Reviewers see a focused diff, not a 384-line file with 3 changed lines.
- **Explicit dependency surfaces.** Each domain file declares exactly what it needs via its deps interface. No hidden coupling through shared module-level state.
- **Independent evolution.** Adding a new observation handler doesn't touch profile or derive code. Adding a new derivator rule doesn't touch LLM inference code.

## Alternatives considered

**Class-based decomposition** (one class per domain) would have required more boilerplate: constructors, method binding, and `this.` everywhere. The function + deps object pattern is lighter and matches how MCP's `server.tool()` registration works.

**Flat file split** (no subdirectory, just `profile-handlers.ts`, `observe-handlers.ts`) was rejected because `handlers/` and `orchestrator/` directories group related files and prevent the root `mcp/` directory from accumulating dozens of loose files.

## Related

- [AGENTS.md](../AGENTS.md) — architecture tree showing the current file structure
- [Database Schema Reference](reference-database.md) — migration history and schema details
- [How Source Precedence Works](howto-source-precedence.md) — the derivator rules that were extracted to `rules.ts`
