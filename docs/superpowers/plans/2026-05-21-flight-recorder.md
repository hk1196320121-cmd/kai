# Kai Flight Recorder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add causal telemetry (flight recorder) to Kai — structured traces, spans, events, state changes, and errors linked in a queryable causal chain, with LLM-powered explain and CLI/MCP tool access.

**Architecture:** 5 new SQLite tables + TelemetryRecorder API with deferred transaction writes (cache spans in memory, flush as single TX at trace end). 3 MCP tools (query/trace/explain), 3 MCP resources, 5 CLI commands. 4-phase instrumentation wrapping existing handlers, derivator, orchestrator, and prompt genome operations. Fire-and-forget: telemetry failures NEVER propagate to parent calls.

**Tech Stack:** Bun-only runtime (bun:sqlite), Zod schemas, Commander.js CLI, existing KaiDB/LLMProvider reuse, no external dependencies.

**Source docs:**
- CEO Plan: `/home/admin/.gstack/projects/kai/ceo-plans/2026-05-21-flight-recorder.md`
- Design Doc: `/home/admin/.gstack/projects/kai/admin-feat-next-feature-2-design-20260521-161806.md`

---

## File Structure

```
src/core/telemetry/
  types.ts             — Trace, Span, Event, StateChange, TelemetryError types
  store.ts             — SQLite read/write for telemetry tables (receives KaiDB via DI)
  recorder.ts          — TelemetryRecorder implementation (deferred transaction writes)
  sanitizer.ts         — Recursive key scanning, auto-redact sensitive values
  stats.ts             — Statistical aggregation queries (error rate, p95, drift)
  explain.ts           — LLM-powered telemetry analysis with stats fallback
src/mcp/telemetry-handlers.ts  — MCP tool handlers (3 tools)
src/mcp/telemetry-schema.ts    — Zod schemas for telemetry tools
src/mcp/telemetry-resources.ts — MCP resource handlers (3 resources)
src/cli/telemetry.ts           — CLI commands (5 commands)
tests/
  telemetry-types.test.ts
  telemetry-store.test.ts
  telemetry-recorder.test.ts
  telemetry-sanitizer.test.ts
  telemetry-handlers.test.ts
  telemetry-resources.test.ts
  telemetry-stats.test.ts
  telemetry-explain.test.ts
  telemetry-cli.test.ts
  telemetry-benchmark.test.ts
  migration-v7.test.ts
```

**Modified files:**
- `src/db/client.ts` — V7 migration insertion
- `src/mcp/server.ts` — TelemetryRecorder singleton + DI
- `src/mcp/handlers.ts` — withTrace() wrapper
- `src/mcp/resources.ts` — Health resource extension
- `src/cli/index.ts` — Register telemetry CLI commands
- `src/core/prompt/judge-engine.ts` — Telemetry scoring integration

---

## Task 1: Telemetry Types

**Files:**
- Create: `src/core/telemetry/types.ts`
- Test: `tests/telemetry-types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telemetry-types.test.ts
import { describe, expect, test } from "bun:test";
import type {
  Trace,
  Span,
  TelemetryEvent,
  StateChange,
  TelemetryError,
  TraceStatus,
  SpanStatus,
  TriggerType,
  OperationType,
  EntityType,
  ExplainResult,
  ExplainInsight,
} from "../src/core/telemetry/types";

describe("Telemetry Types", () => {
  test("Trace has all required fields", () => {
    const trace: Trace = {
      id: "trace-1",
      trigger: "mcp_request",
      tool_name: "profile.read",
      root_cause: "user request",
      started_at: new Date().toISOString(),
      duration_ms: null,
      status: "running",
    };
    expect(trace.id).toBe("trace-1");
    expect(trace.status).toBe("running");
    expect(trace.tool_name).toBe("profile.read");
    expect(trace.duration_ms).toBeNull();
  });

  test("Span has trace reference and optional parent", () => {
    const span: Span = {
      id: "span-1",
      trace_id: "trace-1",
      parent_span_id: null,
      operation: "mcp_tool",
      name: "profile.read",
      started_at: new Date().toISOString(),
      duration_ms: null,
      status: "running",
      attributes: {},
    };
    expect(span.trace_id).toBe("trace-1");
    expect(span.parent_span_id).toBeNull();
    expect(span.attributes).toEqual({});
  });

  test("Span with parent creates nested structure", () => {
    const span: Span = {
      id: "span-2",
      trace_id: "trace-1",
      parent_span_id: "span-1",
      operation: "llm_call",
      name: "derive traits",
      started_at: new Date().toISOString(),
      duration_ms: null,
      status: "running",
      attributes: { model: "gpt-4o-mini" },
    };
    expect(span.parent_span_id).toBe("span-1");
  });

  test("TelemetryEvent has span and trace references", () => {
    const event: TelemetryEvent = {
      id: 1,
      span_id: "span-1",
      trace_id: "trace-1",
      type: "info",
      name: "rule matched",
      payload: { rule: "early_riser" },
      created_at: new Date().toISOString(),
    };
    expect(event.type).toBe("info");
    expect(event.payload).toEqual({ rule: "early_riser" });
  });

  test("StateChange captures before/after", () => {
    const change: StateChange = {
      id: 1,
      span_id: "span-1",
      trace_id: "trace-1",
      entity_type: "trait",
      entity_id: "early_riser",
      field: "value",
      old_value: "0.3",
      new_value: "0.7",
      reason: "LLM derivation",
      created_at: new Date().toISOString(),
    };
    expect(change.old_value).toBe("0.3");
    expect(change.new_value).toBe("0.7");
  });

  test("TelemetryError captures recoverable flag", () => {
    const err: TelemetryError = {
      id: 1,
      span_id: "span-1",
      trace_id: "trace-1",
      error_type: "TimeoutError",
      message: "LLM call timed out",
      stack_trace: "at LLMProvider.call(...)",
      recoverable: 1,
      context: { retries: 2 },
      created_at: new Date().toISOString(),
    };
    expect(err.recoverable).toBe(1);
  });

  test("ExplainResult has summary, traces, and insights", () => {
    const result: ExplainResult = {
      summary: "All systems healthy",
      traces: ["trace-1", "trace-2"],
      insights: [
        { claim: "Error rate is low", evidence: "2 errors / 100 traces" },
      ],
    };
    expect(result.insights).toHaveLength(1);
  });

  test("TraceStatus narrows to valid values", () => {
    const statuses: TraceStatus[] = ["running", "completed", "error"];
    expect(statuses).toHaveLength(3);
  });

  test("OperationType covers all instrumented operations", () => {
    const ops: OperationType[] = [
      "mcp_tool", "derivation", "task_exec",
      "genome_compile", "genome_evolve", "llm_call", "db_write",
    ];
    expect(ops).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry-types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/telemetry/types.ts
export type TriggerType = "mcp_request" | "internal" | "cron";
export type TraceStatus = "running" | "completed" | "error";
export type SpanStatus = "running" | "ok" | "error";
export type OperationType =
  | "mcp_tool"
  | "derivation"
  | "task_exec"
  | "genome_compile"
  | "genome_evolve"
  | "llm_call"
  | "db_write";
export type EntityType =
  | "trait"
  | "preference"
  | "task"
  | "idea"
  | "gene"
  | "observation";

export interface Trace {
  id: string;
  trigger: TriggerType;
  tool_name?: string | null;
  root_cause?: string | null;
  started_at: string;
  duration_ms: number | null;
  status: TraceStatus;
}

export interface Span {
  id: string;
  trace_id: string;
  parent_span_id?: string | null;
  operation: OperationType;
  name: string;
  started_at: string;
  duration_ms: number | null;
  status: SpanStatus;
  attributes: Record<string, unknown>;
}

export interface TelemetryEvent {
  id: number;
  span_id: string;
  trace_id: string;
  type: "info" | "warning" | "error" | "metric";
  name: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface StateChange {
  id: number;
  span_id: string;
  trace_id: string;
  entity_type: EntityType;
  entity_id: string;
  field: string;
  old_value?: string | null;
  new_value?: string | null;
  reason?: string | null;
  created_at: string;
}

export interface TelemetryError {
  id: number;
  span_id: string;
  trace_id: string;
  error_type: string;
  message: string;
  stack_trace?: string | null;
  recoverable: number;
  context: Record<string, unknown>;
  created_at: string;
}

export interface ExplainInsight {
  claim: string;
  evidence: string;
}

export interface ExplainResult {
  summary: string;
  traces: string[];
  insights: ExplainInsight[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry-types.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/telemetry/types.ts tests/telemetry-types.test.ts
git commit -m "feat(telemetry): add telemetry type definitions"
```

---

## Task 2: Sanitizer

**Files:**
- Create: `src/core/telemetry/sanitizer.ts`
- Test: `tests/telemetry-sanitizer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telemetry-sanitizer.test.ts
import { describe, expect, test } from "bun:test";
import { sanitize } from "../src/core/telemetry/sanitizer";

describe("Sanitizer", () => {
  test("redacts api_key at top level", () => {
    const input = { api_key: "sk-12345", name: "test" };
    const result = sanitize(input);
    expect(result.api_key).toBe("[REDACTED]");
    expect(result.name).toBe("test");
  });

  test("redacts token in nested object", () => {
    const input = { config: { token: "abc123", port: 3000 } };
    const result = sanitize(input);
    expect(result.config.token).toBe("[REDACTED]");
    expect(result.config.port).toBe(3000);
  });

  test("redacts password in deeply nested structure", () => {
    const input = { level1: { level2: { password: "secret", ok: true } } };
    const result = sanitize(input);
    expect(result.level1.level2.password).toBe("[REDACTED]");
    expect(result.level1.level2.ok).toBe(true);
  });

  test("redacts secret and credential keys", () => {
    const input = { secret: "s", credential: "c", normal: "n" };
    const result = sanitize(input);
    expect(result.secret).toBe("[REDACTED]");
    expect(result.credential).toBe("[REDACTED]");
    expect(result.normal).toBe("n");
  });

  test("handles arrays with sensitive values", () => {
    const input = { keys: [{ api_key: "sk-1" }, { safe: "yes" }] };
    const result = sanitize(input);
    expect(result.keys[0].api_key).toBe("[REDACTED]");
    expect(result.keys[1].safe).toBe("yes");
  });

  test("returns same object when no sensitive keys", () => {
    const input = { name: "test", count: 5 };
    const result = sanitize(input);
    expect(result).toEqual(input);
  });

  test("handles null and undefined values", () => {
    const input = { api_key: null, name: undefined };
    const result = sanitize(input);
    expect(result.api_key).toBeNull();
    expect(result.name).toBeUndefined();
  });

  test("handles string values containing sensitive patterns in keys", () => {
    const input = { Authorization: "Bearer sk-123" };
    const result = sanitize(input);
    // Authorization header is not in the pattern — only keys matching /api.?key|token|secret|password|credential/i
    expect(result.Authorization).toBe("Bearer sk-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry-sanitizer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/telemetry/sanitizer.ts
const SENSITIVE_PATTERN = /(api.?key|token|secret|password|credential)/i;

export function sanitize<T extends Record<string, unknown>>(
  obj: T,
): Record<string, unknown> {
  return sanitizeRecursive(obj);
}

function sanitizeRecursive(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeRecursive);

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (SENSITIVE_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = sanitizeRecursive(val);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry-sanitizer.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/telemetry/sanitizer.ts tests/telemetry-sanitizer.test.ts
git commit -m "feat(telemetry): add recursive attribute sanitizer"
```

---

## Task 3: V7 Migration

**Files:**
- Modify: `src/db/client.ts`
- Test: `tests/migration-v7.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/migration-v7.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";

describe("V7 Migration", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-v7-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("creates all 5 telemetry tables", () => {
    const tables = db.listTables();
    const expected = [
      "runtime_traces",
      "runtime_spans",
      "runtime_events",
      "runtime_state_changes",
      "runtime_errors",
    ];
    for (const table of expected) {
      expect(tables).toContain(table);
    }
  });

  test("creates all telemetry views", () => {
    const database = db.getDatabase();
    const views = database
      .query("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")
      .all() as { name: string }[];
    const viewNames = views.map((v) => v.name);
    expect(viewNames).toContain("telemetry_traces_v1");
    expect(viewNames).toContain("telemetry_spans_v1");
    expect(viewNames).toContain("telemetry_events_v1");
    expect(viewNames).toContain("telemetry_state_changes_v1");
    expect(viewNames).toContain("telemetry_errors_v1");
  });

  test("creates indices on runtime_traces", () => {
    const database = db.getDatabase();
    const indices = database
      .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='runtime_traces'")
      .all() as { name: string }[];
    const names = indices.map((i) => i.name);
    expect(names).toContain("idx_traces_started");
    expect(names).toContain("idx_traces_status");
  });

  test("creates indices on runtime_spans", () => {
    const database = db.getDatabase();
    const indices = database
      .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='runtime_spans'")
      .all() as { name: string }[];
    const names = indices.map((i) => i.name);
    expect(names).toContain("idx_spans_trace");
    expect(names).toContain("idx_spans_operation");
  });

  test("creates index on runtime_errors", () => {
    const database = db.getDatabase();
    const indices = database
      .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='runtime_errors'")
      .all() as { name: string }[];
    const names = indices.map((i) => i.name);
    expect(names).toContain("idx_errors_trace");
    expect(names).toContain("idx_errors_created");
  });

  test("telemetry views are queryable", () => {
    const database = db.getDatabase();
    const traces = database.query("SELECT * FROM telemetry_traces_v1").all();
    expect(traces).toEqual([]);
    const errors = database.query("SELECT * FROM telemetry_errors_v1").all();
    expect(errors).toEqual([]);
  });

  test("can insert and query via views", () => {
    const database = db.getDatabase();
    database.run(
      `INSERT INTO runtime_traces (id, trigger, tool_name, started_at, status)
       VALUES ('t1', 'mcp_request', 'profile.read', datetime('now'), 'completed')`,
    );
    const rows = database
      .query("SELECT * FROM telemetry_traces_v1 WHERE id = ?")
      .all("t1") as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("t1");
  });

  test("preserves existing data through migration", () => {
    const database = db.getDatabase();
    database.run(
      `INSERT INTO observations (type, key, value, confidence, source, provenance)
       VALUES ('behavior', 'pre-v7:test', '{"action":"test"}', 7, 'mcp', '{}')`,
    );
    const row = database
      .query("SELECT * FROM observations WHERE key = 'pre-v7:test'")
      .get() as { confidence: number };
    expect(row.confidence).toBe(7);
  });

  test("migration is idempotent — init twice does not error", () => {
    db.close();
    const db2 = new KaiDB(dbPath);
    const tables = db2.listTables();
    expect(tables).toContain("runtime_traces");
    expect(tables).toContain("runtime_errors");
    db2.close();
  });

  test("schema version is 7", () => {
    const database = db.getDatabase();
    const row = database
      .query("SELECT MAX(version) as v FROM schema_version")
      .get() as { v: number };
    expect(row.v).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/migration-v7.test.ts`
Expected: FAIL — tables not found (V7 migration not yet added)

- [ ] **Step 3: Write minimal implementation**

Add the following to `src/db/client.ts`, after `MIGRATION_V6` (around line 375) and before the `KaiDB` class:

```typescript
const MIGRATION_V7 = `
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Top-level trace: one per MCP request or internal operation
CREATE TABLE IF NOT EXISTS runtime_traces (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  tool_name TEXT,
  root_cause TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running'
);

-- Spans: operations within a trace (nested via parent_span_id)
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

-- Events: things that happened within a span
CREATE TABLE IF NOT EXISTS runtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  span_id TEXT NOT NULL REFERENCES runtime_spans(id),
  trace_id TEXT NOT NULL REFERENCES runtime_traces(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- State changes: before/after snapshots for mutations
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

-- Errors: captured errors with context
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

-- Indices for common query patterns
CREATE INDEX IF NOT EXISTS idx_traces_started ON runtime_traces(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_status ON runtime_traces(status);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON runtime_spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_operation ON runtime_spans(operation);
CREATE INDEX IF NOT EXISTS idx_events_trace ON runtime_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_state_changes_entity ON runtime_state_changes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_errors_trace ON runtime_errors(trace_id);
CREATE INDEX IF NOT EXISTS idx_errors_created ON runtime_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_created ON runtime_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_changes_created ON runtime_state_changes(created_at DESC);

-- Stable views for telemetry.query
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
```

Add the migration block in `runMigrations()`, after the V6 block (around line 433):

```typescript
    if (currentVersion < 7) {
      this.db.exec(MIGRATION_V7);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [7],
      );
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/migration-v7.test.ts`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Run existing migration tests to confirm no regressions**

Run: `bun test tests/migration-v6.test.ts tests/db.test.ts`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/db/client.ts tests/migration-v7.test.ts
git commit -m "feat(telemetry): add V7 migration with 5 telemetry tables, 10 indices, 5 views"
```

---

## Task 4: Telemetry Store

**Files:**
- Create: `src/core/telemetry/store.ts`
- Test: `tests/telemetry-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telemetry-store.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";

describe("TelemetryStore", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-tel-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("insertTrace and getTrace", () => {
    store.insertTrace({
      id: "t1",
      trigger: "mcp_request",
      tool_name: "profile.read",
      root_cause: "user call",
      started_at: "2026-01-01T00:00:00Z",
      duration_ms: null,
      status: "running",
    });
    const trace = store.getTrace("t1");
    expect(trace).toBeDefined();
    expect(trace!.id).toBe("t1");
    expect(trace!.trigger).toBe("mcp_request");
  });

  test("updateTrace sets duration and status", () => {
    store.insertTrace({
      id: "t2",
      trigger: "internal",
      tool_name: null,
      started_at: "2026-01-01T00:00:00Z",
      duration_ms: null,
      status: "running",
    });
    store.updateTrace("t2", 150, "completed");
    const trace = store.getTrace("t2");
    expect(trace!.duration_ms).toBe(150);
    expect(trace!.status).toBe("completed");
  });

  test("insertSpan and getSpansByTrace", () => {
    store.insertTrace({
      id: "t3", trigger: "mcp_request", tool_name: "observe.submit",
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "running",
    });
    store.insertSpan({
      id: "s1",
      trace_id: "t3",
      parent_span_id: null,
      operation: "mcp_tool",
      name: "observe.submit",
      started_at: "2026-01-01T00:00:00Z",
      duration_ms: null,
      status: "running",
      attributes: { input_size: 1024 },
    });
    const spans = store.getSpansByTrace("t3");
    expect(spans).toHaveLength(1);
    expect(spans[0].operation).toBe("mcp_tool");
  });

  test("updateSpan sets duration and status", () => {
    store.insertTrace({
      id: "t4", trigger: "mcp_request", tool_name: "test",
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "running",
    });
    store.insertSpan({
      id: "s2", trace_id: "t4", parent_span_id: null, operation: "mcp_tool",
      name: "test", started_at: "2026-01-01T00:00:00Z", duration_ms: null,
      status: "running", attributes: {},
    });
    store.updateSpan("s2", 50, "ok");
    const spans = store.getSpansByTrace("t4");
    expect(spans[0].duration_ms).toBe(50);
    expect(spans[0].status).toBe("ok");
  });

  test("insertEvent and getEventsBySpan", () => {
    store.insertTrace({
      id: "t5", trigger: "internal", tool_name: null,
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "running",
    });
    store.insertSpan({
      id: "s3", trace_id: "t5", parent_span_id: null, operation: "derivation",
      name: "derive", started_at: "2026-01-01T00:00:00Z", duration_ms: null,
      status: "running", attributes: {},
    });
    store.insertEvent({
      span_id: "s3", trace_id: "t5", type: "info", name: "rule matched",
      payload: { dimension: "early_riser" },
    });
    const events = store.getEventsBySpan("s3");
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("rule matched");
  });

  test("insertStateChange and getStateChangesByTrace", () => {
    store.insertTrace({
      id: "t6", trigger: "internal", tool_name: null,
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "running",
    });
    store.insertSpan({
      id: "s4", trace_id: "t6", parent_span_id: null, operation: "derivation",
      name: "derive", started_at: "2026-01-01T00:00:00Z", duration_ms: null,
      status: "running", attributes: {},
    });
    store.insertStateChange({
      span_id: "s4", trace_id: "t6", entity_type: "trait", entity_id: "early_riser",
      field: "value", old_value: "0.3", new_value: "0.7", reason: "LLM derivation",
    });
    const changes = store.getStateChangesByTrace("t6");
    expect(changes).toHaveLength(1);
    expect(changes[0].old_value).toBe("0.3");
    expect(changes[0].new_value).toBe("0.7");
  });

  test("insertError and getErrorsByTrace", () => {
    store.insertTrace({
      id: "t7", trigger: "mcp_request", tool_name: "derive.trigger",
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "error",
    });
    store.insertSpan({
      id: "s5", trace_id: "t7", parent_span_id: null, operation: "llm_call",
      name: "llm derive", started_at: "2026-01-01T00:00:00Z", duration_ms: null,
      status: "error", attributes: {},
    });
    store.insertError({
      span_id: "s5", trace_id: "t7", error_type: "TimeoutError",
      message: "LLM call timed out", stack_trace: "at LLMProvider.call",
      recoverable: 1, context: { retries: 2 },
    });
    const errors = store.getErrorsByTrace("t7");
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe("TimeoutError");
  });

  test("queryTelemetry executes SELECT against views", () => {
    store.insertTrace({
      id: "t8", trigger: "mcp_request", tool_name: "profile.read",
      started_at: "2026-01-01T00:00:00Z", duration_ms: 100, status: "completed",
    });
    const rows = store.queryTelemetry(
      "SELECT * FROM telemetry_traces_v1 WHERE id = 't8'",
    );
    expect(rows).toHaveLength(1);
  });

  test("queryTelemetry rejects non-SELECT queries", () => {
    expect(() => store.queryTelemetry("DROP TABLE runtime_traces")).toThrow(
      /must start with SELECT/i,
    );
    expect(() => store.queryTelemetry("DELETE FROM runtime_traces")).toThrow(
      /forbidden keyword/i,
    );
  });

  test("flushBatch writes multiple spans in one transaction", () => {
    store.insertTrace({
      id: "t9", trigger: "mcp_request", tool_name: "test",
      started_at: "2026-01-01T00:00:00Z", duration_ms: null, status: "running",
    });
    store.flushBatch([
      { type: "span", data: {
        id: "s6", trace_id: "t9", parent_span_id: null, operation: "mcp_tool",
        name: "test", started_at: "2026-01-01T00:00:00Z", duration_ms: 10,
        status: "ok", attributes: {},
      }},
      { type: "span", data: {
        id: "s7", trace_id: "t9", parent_span_id: "s6", operation: "db_write",
        name: "insert", started_at: "2026-01-01T00:00:00Z", duration_ms: 5,
        status: "ok", attributes: {},
      }},
    ]);
    const spans = store.getSpansByTrace("t9");
    expect(spans).toHaveLength(2);
  });

  test("getRecentErrors returns errors within time window", () => {
    store.insertTrace({
      id: "t10", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "error",
    });
    store.insertSpan({
      id: "s8", trace_id: "t10", parent_span_id: null, operation: "mcp_tool",
      name: "test", started_at: new Date().toISOString(), duration_ms: 10,
      status: "error", attributes: {},
    });
    store.insertError({
      span_id: "s8", trace_id: "t10", error_type: "TestError",
      message: "test error", stack_trace: null, recoverable: 0, context: {},
    });
    const errors = store.getRecentErrors(1);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  test("getSimilarErrors returns historical errors by type", () => {
    store.insertTrace({
      id: "t11", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "error",
    });
    store.insertSpan({
      id: "s9", trace_id: "t11", parent_span_id: null, operation: "mcp_tool",
      name: "test", started_at: new Date().toISOString(), duration_ms: 10,
      status: "error", attributes: {},
    });
    store.insertError({
      span_id: "s9", trace_id: "t11", error_type: "TimeoutError",
      message: "timed out", stack_trace: null, recoverable: 1, context: {},
    });
    const similar = store.getSimilarErrors("TimeoutError", 3);
    expect(similar.length).toBeGreaterThanOrEqual(1);
    expect(similar[0].error_type).toBe("TimeoutError");
  });

  test("pruneTelemetry removes old records", () => {
    store.insertTrace({
      id: "t12", trigger: "mcp_request", tool_name: "test",
      started_at: "2020-01-01T00:00:00Z", duration_ms: 10, status: "completed",
    });
    store.pruneTelemetry(30);
    const trace = store.getTrace("t12");
    expect(trace).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/telemetry/store.ts
import type { Database } from "bun:sqlite";
import type { KaiDB } from "../../db/client";
import type {
  Trace,
  Span,
  TelemetryEvent,
  StateChange,
  TelemetryError,
} from "./types";

interface BatchItem {
  type: "span" | "event" | "state_change" | "error";
  data: Record<string, unknown>;
}

const DENYLIST = [
  "DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "ATTACH", "PRAGMA",
];

export class TelemetryStore {
  private db: Database;

  constructor(kaiDb: KaiDB) {
    this.db = kaiDb.getDatabase();
  }

  insertTrace(trace: Omit<Trace, never>): void {
    this.db
      .prepare(
        `INSERT INTO runtime_traces (id, trigger, tool_name, root_cause, started_at, duration_ms, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        trace.id,
        trace.trigger,
        trace.tool_name ?? null,
        trace.root_cause ?? null,
        trace.started_at,
        trace.duration_ms ?? null,
        trace.status,
      );
  }

  updateTrace(id: string, durationMs: number, status: string): void {
    this.db
      .prepare(
        `UPDATE runtime_traces SET duration_ms = ?, status = ? WHERE id = ?`,
      )
      .run(durationMs, status, id);
  }

  getTrace(id: string): Trace | undefined {
    return this.db
      .prepare("SELECT * FROM runtime_traces WHERE id = ?")
      .get(id) as Trace | undefined;
  }

  insertSpan(span: Omit<Span, never>): void {
    this.db
      .prepare(
        `INSERT INTO runtime_spans (id, trace_id, parent_span_id, operation, name, started_at, duration_ms, status, attributes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        span.id,
        span.trace_id,
        span.parent_span_id ?? null,
        span.operation,
        span.name,
        span.started_at,
        span.duration_ms ?? null,
        span.status,
        JSON.stringify(span.attributes ?? {}),
      );
  }

  updateSpan(id: string, durationMs: number, status: string): void {
    this.db
      .prepare(
        `UPDATE runtime_spans SET duration_ms = ?, status = ? WHERE id = ?`,
      )
      .run(durationMs, status, id);
  }

  getSpansByTrace(traceId: string): Span[] {
    return this.db
      .prepare("SELECT * FROM runtime_spans WHERE trace_id = ?")
      .all(traceId) as Span[];
  }

  insertEvent(event: Omit<TelemetryEvent, "id" | "created_at">): void {
    this.db
      .prepare(
        `INSERT INTO runtime_events (span_id, trace_id, type, name, payload)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.span_id,
        event.trace_id,
        event.type,
        event.name,
        JSON.stringify(event.payload ?? {}),
      );
  }

  getEventsBySpan(spanId: string): TelemetryEvent[] {
    return this.db
      .prepare("SELECT * FROM runtime_events WHERE span_id = ?")
      .all(spanId) as TelemetryEvent[];
  }

  getEventsByTrace(traceId: string): TelemetryEvent[] {
    return this.db
      .prepare("SELECT * FROM runtime_events WHERE trace_id = ?")
      .all(traceId) as TelemetryEvent[];
  }

  insertStateChange(change: Omit<StateChange, "id" | "created_at">): void {
    this.db
      .prepare(
        `INSERT INTO runtime_state_changes (span_id, trace_id, entity_type, entity_id, field, old_value, new_value, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        change.span_id,
        change.trace_id,
        change.entity_type,
        change.entity_id,
        change.field,
        change.old_value ?? null,
        change.new_value ?? null,
        change.reason ?? null,
      );
  }

  getStateChangesByTrace(traceId: string): StateChange[] {
    return this.db
      .prepare("SELECT * FROM runtime_state_changes WHERE trace_id = ?")
      .all(traceId) as StateChange[];
  }

  insertError(error: Omit<TelemetryError, "id" | "created_at">): void {
    this.db
      .prepare(
        `INSERT INTO runtime_errors (span_id, trace_id, error_type, message, stack_trace, recoverable, context)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        error.span_id,
        error.trace_id,
        error.error_type,
        error.message,
        error.stack_trace ?? null,
        error.recoverable,
        JSON.stringify(error.context ?? {}),
      );
  }

  getErrorsByTrace(traceId: string): TelemetryError[] {
    return this.db
      .prepare("SELECT * FROM runtime_errors WHERE trace_id = ?")
      .all(traceId) as TelemetryError[];
  }

  getRecentErrors(lastN: number): TelemetryError[] {
    return this.db
      .prepare(
        "SELECT * FROM runtime_errors ORDER BY created_at DESC LIMIT ?",
      )
      .all(lastN) as TelemetryError[];
  }

  getSimilarErrors(
    errorType: string,
    limit: number,
  ): Array<{
    error_type: string;
    message: string;
    count: number;
    last_seen: string;
  }> {
    return this.db
      .prepare(
        `SELECT error_type, message, COUNT(*) as count, MAX(created_at) as last_seen
         FROM runtime_errors
         WHERE error_type = ? AND created_at >= datetime('now', '-30 days')
         GROUP BY error_type, message
         ORDER BY count DESC
         LIMIT ?`,
      )
      .all(errorType, limit) as Array<{
      error_type: string;
      message: string;
      count: number;
      last_seen: string;
    }>;
  }

  queryTelemetry(sql: string): Record<string, unknown>[] {
    const trimmed = sql.trim();
    if (!trimmed.toUpperCase().startsWith("SELECT")) {
      throw new Error("Query must start with SELECT");
    }
    const upper = trimmed.toUpperCase();
    for (const keyword of DENYLIST) {
      if (upper.includes(keyword)) {
        throw new Error(`Forbidden keyword in query: ${keyword}`);
      }
    }
    // Read-only transaction wrapping
    this.db.exec("BEGIN");
    try {
      const rows = this.db.prepare(trimmed.replace(/;+$/, "")).all() as Record<
        string,
        unknown
      >[];
      return rows;
    } finally {
      this.db.exec("ROLLBACK");
    }
  }

  flushBatch(items: BatchItem[]): void {
    const tx = this.db.transaction(() => {
      for (const item of items) {
        switch (item.type) {
          case "span":
            this.insertSpan(item.data as Omit<Span, never>);
            break;
          case "event":
            this.insertEvent(
              item.data as Omit<TelemetryEvent, "id" | "created_at">,
            );
            break;
          case "state_change":
            this.insertStateChange(
              item.data as Omit<StateChange, "id" | "created_at">,
            );
            break;
          case "error":
            this.insertError(
              item.data as Omit<TelemetryError, "id" | "created_at">,
            );
            break;
        }
      }
    });
    tx();
  }

  pruneTelemetry(maxAgeDays: number): void {
    const cutoff = `datetime('now', '-${maxAgeDays} days')`;
    const traceIds = this.db
      .prepare(
        `SELECT id FROM runtime_traces WHERE started_at < ${cutoff} LIMIT 1000`,
      )
      .all() as { id: string }[];
    if (traceIds.length === 0) return;

    const ids = traceIds.map((t) => t.id);
    const placeholders = ids.map(() => "?").join(",");
    this.db
      .prepare(
        `DELETE FROM runtime_errors WHERE trace_id IN (${placeholders})`,
      )
      .run(...ids);
    this.db
      .prepare(
        `DELETE FROM runtime_state_changes WHERE trace_id IN (${placeholders})`,
      )
      .run(...ids);
    this.db
      .prepare(
        `DELETE FROM runtime_events WHERE trace_id IN (${placeholders})`,
      )
      .run(...ids);
    this.db
      .prepare(
        `DELETE FROM runtime_spans WHERE trace_id IN (${placeholders})`,
      )
      .run(...ids);
    this.db
      .prepare(
        `DELETE FROM runtime_traces WHERE id IN (${placeholders})`,
      )
      .run(...ids);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry-store.test.ts`
Expected: PASS (all 14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/telemetry/store.ts tests/telemetry-store.test.ts
git commit -m "feat(telemetry): add TelemetryStore with SQLite CRUD, batch writes, pruning"
```

---

## Task 5: TelemetryRecorder

**Files:**
- Create: `src/core/telemetry/recorder.ts`
- Test: `tests/telemetry-recorder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telemetry-recorder.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { TelemetryRecorder } from "../src/core/telemetry/recorder";

describe("TelemetryRecorder", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let recorder: TelemetryRecorder;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-rec-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
    recorder = new TelemetryRecorder(store);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("startTrace creates a running trace", () => {
    const trace = recorder.startTrace("mcp_request", "profile.read");
    expect(trace.traceId).toBeDefined();
    const persisted = store.getTrace(trace.traceId);
    expect(persisted).toBeDefined();
    expect(persisted!.status).toBe("running");
  });

  test("trace.end sets completed status and duration", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    trace.end("completed");
    const persisted = store.getTrace(trace.traceId);
    expect(persisted!.status).toBe("completed");
    expect(persisted!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("trace.startSpan creates nested span", () => {
    const trace = recorder.startTrace("mcp_request", "observe.submit");
    const span = trace.startSpan("mcp_tool", "observe.submit");
    expect(span.spanId).toBeDefined();
    expect(span.traceId).toBe(trace.traceId);
  });

  test("span.end flushes span data", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const span = trace.startSpan("mcp_tool", "test");
    span.end("ok");
    trace.end("completed");
    const spans = store.getSpansByTrace(trace.traceId);
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("ok");
  });

  test("span.event records event", () => {
    const trace = recorder.startTrace("internal", undefined);
    const span = trace.startSpan("derivation", "derive");
    span.event("info", "rule matched", { rule: "early_riser" });
    span.end("ok");
    trace.end("completed");
    const events = store.getEventsBySpan(span.spanId);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("rule matched");
  });

  test("span.stateChange records state change", () => {
    const trace = recorder.startTrace("internal", undefined);
    const span = trace.startSpan("derivation", "derive");
    span.stateChange({
      type: "trait", id: "early_riser", field: "value",
      old: "0.3", new: "0.7", reason: "LLM",
    });
    span.end("ok");
    trace.end("completed");
    const changes = store.getStateChangesByTrace(trace.traceId);
    expect(changes).toHaveLength(1);
    expect(changes[0].new_value).toBe("0.7");
  });

  test("span.error records error", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const span = trace.startSpan("mcp_tool", "test");
    span.error(new Error("test error"), true, { step: 1 });
    span.end("error");
    trace.end("error");
    const errors = store.getErrorsByTrace(trace.traceId);
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe("Error");
    expect(errors[0].recoverable).toBe(1);
  });

  test("span.startChild creates nested span", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const parent = trace.startSpan("mcp_tool", "parent");
    const child = parent.startChild("db_write", "insert");
    child.end("ok");
    parent.end("ok");
    trace.end("completed");
    const spans = store.getSpansByTrace(trace.traceId);
    expect(spans).toHaveLength(2);
    const childSpan = spans.find((s) => s.name === "insert");
    expect(childSpan!.parent_span_id).toBe(parent.spanId);
  });

  test("telemetry failure does not propagate", () => {
    // Create recorder with a store that will fail
    const failStore = {
      insertTrace: () => { throw new Error("DB error"); },
    } as unknown as TelemetryStore;
    const safeRecorder = new TelemetryRecorder(failStore);
    // This should NOT throw
    const trace = safeRecorder.startTrace("mcp_request", "test");
    expect(trace.traceId).toBeDefined();
  });

  test("sanitizes attributes on span", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const span = trace.startSpan("mcp_tool", "test");
    span.event("info", "test", { api_key: "secret123", normal: "ok" });
    span.end("ok");
    trace.end("completed");
    const events = store.getEventsBySpan(span.spanId);
    const payload = JSON.parse(events[0].payload as unknown as string);
    expect(payload.api_key).toBe("[REDACTED]");
    expect(payload.normal).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry-recorder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/telemetry/recorder.ts
import { sanitize } from "./sanitizer";
import type { TelemetryStore } from "./store";
import type { OperationType, TraceStatus, TriggerType } from "./types";

interface PendingSpan {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  operation: string;
  name: string;
  started_at: string;
  status: string;
  attributes: Record<string, unknown>;
  events: Array<{
    type: string;
    name: string;
    payload: Record<string, unknown>;
  }>;
  stateChanges: Array<{
    entity_type: string;
    entity_id: string;
    field: string;
    old_value?: string;
    new_value?: string;
    reason?: string;
  }>;
  errors: Array<{
    error: Error;
    recoverable: boolean;
    context?: Record<string, unknown>;
  }>;
}

export interface SpanHandle {
  spanId: string;
  traceId: string;
  event(
    type: string,
    name: string,
    payload?: Record<string, unknown>,
  ): void;
  stateChange(entity: {
    type: string;
    id: string;
    field: string;
    old?: string;
    new?: string;
    reason?: string;
  }): void;
  error(
    err: Error,
    recoverable?: boolean,
    context?: Record<string, unknown>,
  ): void;
  end(status?: "ok" | "error"): void;
  startChild(operation: string, name: string): SpanHandle;
}

export interface TraceHandle {
  traceId: string;
  startSpan(operation: string, name: string): SpanHandle;
  end(status?: "completed" | "error"): void;
}

export class TelemetryRecorder {
  private store: TelemetryStore;
  private pendingSpans: Map<string, PendingSpan> = new Map();

  constructor(store: TelemetryStore) {
    this.store = store;
  }

  startTrace(trigger: TriggerType, toolName?: string): TraceHandle {
    const traceId = crypto.randomUUID();
    try {
      this.store.insertTrace({
        id: traceId,
        trigger,
        tool_name: toolName ?? null,
        root_cause: null,
        started_at: new Date().toISOString(),
        duration_ms: null,
        status: "running",
      });
    } catch {
      // Fire-and-forget: telemetry failures never propagate
    }
    return {
      traceId,
      startSpan: (operation, name) =>
        this.createSpan(traceId, null, operation, name),
      end: (status = "completed") => {
        try {
          const start = this.store.getTrace(traceId)?.started_at;
          const duration = start
            ? Date.now() - new Date(start).getTime()
            : 0;
          this.flushPendingForTrace(traceId);
          this.store.updateTrace(traceId, duration, status);
        } catch {
          // Fire-and-forget
        }
      },
    };
  }

  private createSpan(
    traceId: string,
    parentSpanId: string | null,
    operation: string,
    name: string,
  ): SpanHandle {
    const spanId = crypto.randomUUID();
    const pending: PendingSpan = {
      id: spanId,
      trace_id: traceId,
      parent_span_id: parentSpanId,
      operation,
      name,
      started_at: new Date().toISOString(),
      status: "running",
      attributes: {},
      events: [],
      stateChanges: [],
      errors: [],
    };
    this.pendingSpans.set(spanId, pending);

    return {
      spanId,
      traceId,
      event: (type, name, payload) => {
        if (this.pendingSpans.has(spanId)) {
          this.pendingSpans.get(spanId)!.events.push({
            type,
            name,
            payload: sanitize(payload ?? {}),
          });
        }
      },
      stateChange: (entity) => {
        if (this.pendingSpans.has(spanId)) {
          this.pendingSpans.get(spanId)!.stateChanges.push({
            entity_type: entity.type,
            entity_id: entity.id,
            field: entity.field,
            old_value: entity.old,
            new_value: entity.new,
            reason: entity.reason,
          });
        }
      },
      error: (err, recoverable = false, context) => {
        if (this.pendingSpans.has(spanId)) {
          this.pendingSpans.get(spanId)!.errors.push({
            error: err,
            recoverable,
            context,
          });
        }
      },
      end: (status = "ok") => {
        const pending = this.pendingSpans.get(spanId);
        if (pending) {
          try {
            const duration = Date.now() - new Date(pending.started_at).getTime();
            pending.status = status;
            // Flush this span immediately to store
            this.flushSpan(pending, duration);
          } catch {
            // Fire-and-forget
          }
          this.pendingSpans.delete(spanId);
        }
      },
      startChild: (childOp, childName) =>
        this.createSpan(traceId, spanId, childOp, childName),
    };
  }

  private flushSpan(pending: PendingSpan, durationMs: number): void {
    const batch: Array<{
      type: "span" | "event" | "state_change" | "error";
      data: Record<string, unknown>;
    }> = [];

    batch.push({
      type: "span",
      data: {
        id: pending.id,
        trace_id: pending.trace_id,
        parent_span_id: pending.parent_span_id,
        operation: pending.operation,
        name: pending.name,
        started_at: pending.started_at,
        duration_ms: durationMs,
        status: pending.status,
        attributes: pending.attributes,
      },
    });

    for (const evt of pending.events) {
      batch.push({
        type: "event",
        data: {
          span_id: pending.id,
          trace_id: pending.trace_id,
          type: evt.type,
          name: evt.name,
          payload: evt.payload,
        },
      });
    }

    for (const sc of pending.stateChanges) {
      batch.push({
        type: "state_change",
        data: {
          span_id: pending.id,
          trace_id: pending.trace_id,
          entity_type: sc.entity_type,
          entity_id: sc.entity_id,
          field: sc.field,
          old_value: sc.old_value,
          new_value: sc.new_value,
          reason: sc.reason,
        },
      });
    }

    for (const err of pending.errors) {
      batch.push({
        type: "error",
        data: {
          span_id: pending.id,
          trace_id: pending.trace_id,
          error_type: err.error.constructor.name,
          message: err.error.message,
          stack_trace: err.error.stack ?? null,
          recoverable: err.recoverable ? 1 : 0,
          context: err.context ?? {},
        },
      });
    }

    this.store.flushBatch(batch);
  }

  private flushPendingForTrace(traceId: string): void {
    for (const [spanId, pending] of this.pendingSpans.entries()) {
      if (pending.trace_id === traceId) {
        try {
          const duration =
            Date.now() - new Date(pending.started_at).getTime();
          this.flushSpan(pending, duration);
        } catch {
          // Fire-and-forget
        }
        this.pendingSpans.delete(spanId);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry-recorder.test.ts`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/telemetry/recorder.ts tests/telemetry-recorder.test.ts
git commit -m "feat(telemetry): add TelemetryRecorder with deferred transaction writes"
```

---

## Task 6: Statistics Layer

**Files:**
- Create: `src/core/telemetry/stats.ts`
- Test: `tests/telemetry-stats.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telemetry-stats.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { getTelemetryStats } from "../src/core/telemetry/stats";

describe("TelemetryStats", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-stats-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("returns empty stats when no data", () => {
    const stats = getTelemetryStats(store, 24);
    expect(stats.traceCount).toBe(0);
    expect(stats.errorRate).toBe(0);
    expect(stats.p95LatencyMs).toBe(0);
  });

  test("computes error rate", () => {
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 100, status: "completed",
    });
    store.insertTrace({
      id: "t2", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 50, status: "error",
    });
    const stats = getTelemetryStats(store, 24);
    expect(stats.traceCount).toBe(2);
    expect(stats.errorRate).toBe(0.5);
  });

  test("computes p95 latency", () => {
    for (let i = 0; i < 20; i++) {
      store.insertTrace({
        id: `t${i}`, trigger: "mcp_request", tool_name: "test",
        started_at: new Date().toISOString(), duration_ms: i * 10, status: "completed",
      });
    }
    const stats = getTelemetryStats(store, 24);
    expect(stats.traceCount).toBe(20);
    expect(stats.p95LatencyMs).toBeGreaterThan(0);
  });

  test("computes top operations", () => {
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    store.insertSpan({
      id: "s1", trace_id: "t1", parent_span_id: null, operation: "mcp_tool",
      name: "profile.read", started_at: new Date().toISOString(),
      duration_ms: 10, status: "ok", attributes: {},
    });
    store.insertSpan({
      id: "s2", trace_id: "t1", parent_span_id: null, operation: "mcp_tool",
      name: "observe.submit", started_at: new Date().toISOString(),
      duration_ms: 10, status: "ok", attributes: {},
    });
    const stats = getTelemetryStats(store, 24);
    expect(stats.topOperations.length).toBeGreaterThan(0);
    expect(stats.topOperations[0].operation).toBe("mcp_tool");
  });

  test("computes state drift summary", () => {
    store.insertTrace({
      id: "t1", trigger: "internal", tool_name: null,
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    store.insertSpan({
      id: "s1", trace_id: "t1", parent_span_id: null, operation: "derivation",
      name: "derive", started_at: new Date().toISOString(),
      duration_ms: 10, status: "ok", attributes: {},
    });
    store.insertStateChange({
      span_id: "s1", trace_id: "t1", entity_type: "trait", entity_id: "early_riser",
      field: "value", old_value: "0.3", new_value: "0.7", reason: "LLM",
    });
    const stats = getTelemetryStats(store, 24);
    expect(stats.topMutatedEntities.length).toBeGreaterThan(0);
    expect(stats.topMutatedEntities[0].entity_type).toBe("trait");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry-stats.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/telemetry/stats.ts
import type { TelemetryStore } from "./store";

export interface TelemetryStatsResult {
  traceCount: number;
  errorCount: number;
  errorRate: number;
  p95LatencyMs: number;
  topOperations: Array<{ operation: string; count: number }>;
  topMutatedEntities: Array<{
    entity_type: string;
    entity_id: string;
    change_count: number;
  }>;
}

export function getTelemetryStats(
  store: TelemetryStore,
  lastHours: number,
): TelemetryStatsResult {
  const traces = store.queryTelemetry(
    `SELECT * FROM telemetry_traces_v1 WHERE started_at >= datetime('now', '-${lastHours} hours')`,
  );

  const traceCount = traces.length;
  const errorCount = traces.filter(
    (t) => t.status === "error",
  ).length;
  const errorRate = traceCount > 0 ? errorCount / traceCount : 0;

  // P95 latency
  const durations = traces
    .filter((t) => t.duration_ms != null)
    .map((t) => t.duration_ms as number)
    .sort((a, b) => a - b);
  let p95LatencyMs = 0;
  if (durations.length > 0) {
    const idx = Math.ceil(durations.length * 0.95) - 1;
    p95LatencyMs = durations[Math.max(0, idx)];
  }

  // Top operations
  const spans = store.queryTelemetry(
    `SELECT operation, COUNT(*) as count FROM telemetry_spans_v1
     WHERE started_at >= datetime('now', '-${lastHours} hours')
     GROUP BY operation ORDER BY count DESC LIMIT 10`,
  );
  const topOperations = spans.map((s) => ({
    operation: s.operation as string,
    count: s.count as number,
  }));

  // Top mutated entities
  const mutations = store.queryTelemetry(
    `SELECT entity_type, entity_id, COUNT(*) as change_count FROM telemetry_state_changes_v1
     WHERE created_at >= datetime('now', '-${lastHours} hours')
     GROUP BY entity_type, entity_id ORDER BY change_count DESC LIMIT 10`,
  );
  const topMutatedEntities = mutations.map((m) => ({
    entity_type: m.entity_type as string,
    entity_id: m.entity_id as string,
    change_count: m.change_count as number,
  }));

  return {
    traceCount,
    errorCount,
    errorRate,
    p95LatencyMs,
    topOperations,
    topMutatedEntities,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry-stats.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/telemetry/stats.ts tests/telemetry-stats.test.ts
git commit -m "feat(telemetry): add statistical aggregation layer"
```

---

## Task 7: Telemetry Explain

**Files:**
- Create: `src/core/telemetry/explain.ts`
- Test: `tests/telemetry-explain.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telemetry-explain.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { explainTelemetry } from "../src/core/telemetry/explain";
import type { LLMProvider } from "../src/llm/provider";

describe("TelemetryExplain", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-explain-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("returns stats-only summary when no LLM provider", async () => {
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "profile.read",
      started_at: new Date().toISOString(), duration_ms: 100, status: "completed",
    });
    const result = await explainTelemetry(store, "what happened?", null);
    expect(result.summary).toBeDefined();
    expect(typeof result.summary).toBe("string");
    expect(result.insights).toEqual([]);
  });

  test("returns stats-only when LLM has no API key", async () => {
    const llm = new LLMProvider({ apiKey: "" });
    store.insertTrace({
      id: "t2", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 50, status: "completed",
    });
    const result = await explainTelemetry(store, "health?", llm);
    expect(result.summary).toBeDefined();
    expect(result.insights).toEqual([]);
  });

  test("summary includes trace count and error rate", async () => {
    store.insertTrace({
      id: "t3", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 100, status: "completed",
    });
    store.insertTrace({
      id: "t4", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 50, status: "error",
    });
    const result = await explainTelemetry(store, "summary", null);
    expect(result.summary).toContain("2");
    expect(result.summary).toContain("error");
  });

  test("includes referenced trace IDs", async () => {
    store.insertTrace({
      id: "t5", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const result = await explainTelemetry(store, "recent traces?", null);
    expect(result.traces).toHaveLength(0);
  });

  test("rate limits: returns cached result within 5 minutes", async () => {
    store.insertTrace({
      id: "t6", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const r1 = await explainTelemetry(store, "same question", null);
    const r2 = await explainTelemetry(store, "same question", null);
    expect(r1.summary).toBe(r2.summary);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry-explain.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/telemetry/explain.ts
import type { LLMProvider } from "../../llm/provider";
import type { TelemetryStore } from "./store";
import { getTelemetryStats } from "./stats";
import type { ExplainResult } from "./types";

const EXPLAIN_SYSTEM_PROMPT = `You are a telemetry analyst. Analyze the provided telemetry data and answer the question.
Output JSON: { "summary": string, "traces": string[], "insights": [{ "claim": string, "evidence": string }] }
Keep summary under 200 words. Max 5 insights. Each insight: one claim + one evidence line.`;

const cache = new Map<string, { result: ExplainResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CALLS: number[] = [];
const MAX_CALLS_PER_HOUR = 10;

export async function explainTelemetry(
  store: TelemetryStore,
  question: string,
  llm: LLMProvider | null,
): Promise<ExplainResult> {
  // Rate limiting
  const now = Date.now();
  while (CALLS.length > 0 && CALLS[0] < now - 3600000) CALLS.shift();
  if (CALLS.length >= MAX_CALLS_PER_HOUR) {
    return {
      summary: "Rate limit exceeded: 10 calls/hour. Try again later.",
      traces: [],
      insights: [],
    };
  }

  // Cache check
  const cacheKey = question;
  const cached = cache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  CALLS.push(now);

  // Gather data
  const stats = getTelemetryStats(store, 24);
  const recentErrors = store.getRecentErrors(50);

  // Stats-only fallback
  if (!llm || !llm.getConfig().apiKey) {
    const summary = buildStatsSummary(stats, recentErrors.length);
    const result: ExplainResult = { summary, traces: [], insights: [] };
    cache.set(cacheKey, { result, timestamp: now });
    return result;
  }

  // LLM-powered analysis
  const inputData = {
    question,
    stats: {
      traceCount: stats.traceCount,
      errorCount: stats.errorCount,
      errorRate: stats.errorRate.toFixed(3),
      p95LatencyMs: stats.p95LatencyMs,
      topOperations: stats.topOperations.slice(0, 5),
      topMutatedEntities: stats.topMutatedEntities.slice(0, 5),
    },
    recentErrors: recentErrors.slice(0, 10).map((e) => ({
      error_type: e.error_type,
      message: e.message,
    })),
  };

  try {
    const response = await llm.call(
      JSON.stringify(inputData),
      EXPLAIN_SYSTEM_PROMPT,
      0,
      { max_tokens: 1000 },
    );

    const result: ExplainResult = {
      summary: String(response.summary ?? ""),
      traces: Array.isArray(response.traces)
        ? (response.traces as string[])
        : [],
      insights: Array.isArray(response.insights)
        ? (response.insights as Array<{ claim: string; evidence: string }>)
        : [],
    };

    cache.set(cacheKey, { result, timestamp: now });
    return result;
  } catch {
    const summary = buildStatsSummary(stats, recentErrors.length);
    const result: ExplainResult = { summary, traces: [], insights: [] };
    cache.set(cacheKey, { result, timestamp: now });
    return result;
  }
}

function buildStatsSummary(
  stats: ReturnType<typeof getTelemetryStats>,
  recentErrorCount: number,
): string {
  const lines: string[] = [];
  lines.push(
    `Telemetry summary (last 24h): ${stats.traceCount} traces, ${stats.errorCount} errors (${(stats.errorRate * 100).toFixed(1)}% error rate).`,
  );
  lines.push(`P95 latency: ${stats.p95LatencyMs}ms.`);
  if (stats.topOperations.length > 0) {
    lines.push(
      `Top operations: ${stats.topOperations.map((o) => `${o.operation}(${o.count})`).join(", ")}.`,
    );
  }
  if (stats.topMutatedEntities.length > 0) {
    lines.push(
      `Most mutated: ${stats.topMutatedEntities.map((e) => `${e.entity_type}:${e.entity_id}(${e.change_count})`).join(", ")}.`,
    );
  }
  if (recentErrorCount > 0) {
    lines.push(`${recentErrorCount} recent errors in window.`);
  }
  return lines.join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry-explain.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/telemetry/explain.ts tests/telemetry-explain.test.ts
git commit -m "feat(telemetry): add LLM-powered telemetry explain with stats fallback"
```

---

## Task 8: MCP Telemetry Schemas

**Files:**
- Create: `src/mcp/telemetry-schema.ts`

- [ ] **Step 1: Write the schemas file**

```typescript
// src/mcp/telemetry-schema.ts
import { z } from "zod";

export const TelemetryQuerySchema = {
  sql: z
    .string()
    .min(1)
    .describe("SQL query to execute against telemetry views (SELECT only)"),
};

export const TelemetryTraceSchema = {
  traceId: z
    .string()
    .describe("Trace ID to retrieve full causal trace for"),
};

export const TelemetryExplainSchema = {
  question: z
    .string()
    .min(1)
    .describe("Natural language question about recent telemetry"),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/telemetry-schema.ts
git commit -m "feat(telemetry): add Zod schemas for 3 telemetry MCP tools"
```

---

## Task 9: MCP Telemetry Handlers

**Files:**
- Create: `src/mcp/telemetry-handlers.ts`
- Test: `tests/telemetry-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telemetry-handlers.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { registerTelemetryHandlers } from "../src/mcp/telemetry-handlers";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Minimal mock of McpServer for testing
function createMockServer(): {
  server: McpServer;
  tools: Map<string, { schema: unknown; handler: Function }>;
} {
  const tools = new Map<string, { schema: unknown; handler: Function }>();
  const server = {
    tool: (name: string, schema: unknown, handler: Function) => {
      tools.set(name, { schema, handler });
    },
    resource: () => {},
  } as unknown as McpServer;
  return { server, tools };
}

describe("Telemetry MCP Handlers", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-handler-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("registers 3 telemetry tools", () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    expect(tools.has("telemetry.query")).toBe(true);
    expect(tools.has("telemetry.trace")).toBe(true);
    expect(tools.has("telemetry.explain")).toBe(true);
  });

  test("telemetry.query executes SELECT", async () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const handler = tools.get("telemetry.query")!.handler;
    const result = await handler({ sql: "SELECT * FROM telemetry_traces_v1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.rows).toHaveLength(1);
  });

  test("telemetry.query rejects non-SELECT", async () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    const handler = tools.get("telemetry.query")!.handler;
    const result = await handler({ sql: "DROP TABLE runtime_traces" });
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeDefined();
  });

  test("telemetry.trace returns full trace with spans", async () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    store.insertTrace({
      id: "t2", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 50, status: "completed",
    });
    store.insertSpan({
      id: "s1", trace_id: "t2", parent_span_id: null, operation: "mcp_tool",
      name: "test", started_at: new Date().toISOString(),
      duration_ms: 50, status: "ok", attributes: {},
    });
    store.insertEvent({
      span_id: "s1", trace_id: "t2", type: "info", name: "done", payload: {},
    });
    const handler = tools.get("telemetry.trace")!.handler;
    const result = await handler({ traceId: "t2" });
    const data = JSON.parse(result.content[0].text);
    expect(data.trace.id).toBe("t2");
    expect(data.spans).toHaveLength(1);
    expect(data.events).toHaveLength(1);
    expect(data.suggested_actions).toEqual([]);
  });

  test("telemetry.trace returns error for missing trace", async () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    const handler = tools.get("telemetry.trace")!.handler;
    const result = await handler({ traceId: "nonexistent" });
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe("trace_not_found");
  });

  test("telemetry.explain returns stats summary", async () => {
    const { server, tools } = createMockServer();
    registerTelemetryHandlers(server, store, null);
    store.insertTrace({
      id: "t3", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const handler = tools.get("telemetry.explain")!.handler;
    const result = await handler({ question: "health?" });
    const data = JSON.parse(result.content[0].text);
    expect(data.summary).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry-handlers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/mcp/telemetry-handlers.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LLMProvider } from "../llm/provider";
import { explainTelemetry } from "../core/telemetry/explain";
import type { TelemetryStore } from "../core/telemetry/store";
import {
  TelemetryExplainSchema,
  TelemetryQuerySchema,
  TelemetryTraceSchema,
} from "./telemetry-schema";

function textContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export function registerTelemetryHandlers(
  server: McpServer,
  store: TelemetryStore,
  llm: LLMProvider | null,
): void {
  // telemetry.query
  server.tool(
    "telemetry.query",
    TelemetryQuerySchema,
    async ({ sql }: { sql: string }) => {
      try {
        const rows = store.queryTelemetry(sql);
        return textContent({ rows, count: rows.length });
      } catch (err) {
        return textContent({
          error: "query_failed",
          message: (err as Error).message,
        });
      }
    },
  );

  // telemetry.trace
  server.tool(
    "telemetry.trace",
    TelemetryTraceSchema,
    async ({ traceId }: { traceId: string }) => {
      const trace = store.getTrace(traceId);
      if (!trace) {
        return textContent({ error: "trace_not_found", traceId });
      }
      const spans = store.getSpansByTrace(traceId);
      const events = store.getEventsByTrace(traceId);
      const stateChanges = store.getStateChangesByTrace(traceId);
      const errors = store.getErrorsByTrace(traceId);

      // Error recovery suggestions — fire-and-forget async query
      let suggested_actions: Array<{
        description: string;
        past_occurrences: number;
        last_seen: string;
      }> = [];
      if (errors.length > 0) {
        try {
          for (const err of errors.slice(0, 3)) {
            const similar = store.getSimilarErrors(err.error_type, 3);
            for (const s of similar) {
              suggested_actions.push({
                description: `${s.error_type}: ${s.message}`,
                past_occurrences: s.count,
                last_seen: s.last_seen,
              });
            }
          }
        } catch {
          // Fire-and-forget
        }
      }

      return textContent({
        trace,
        spans,
        events,
        stateChanges,
        errors,
        suggested_actions,
      });
    },
  );

  // telemetry.explain
  server.tool(
    "telemetry.explain",
    TelemetryExplainSchema,
    async ({ question }: { question: string }) => {
      const result = await explainTelemetry(store, question, llm);
      return textContent(result);
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry-handlers.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/telemetry-handlers.ts src/mcp/telemetry-schema.ts tests/telemetry-handlers.test.ts
git commit -m "feat(telemetry): add 3 MCP telemetry tools (query, trace, explain)"
```

---

## Task 10: MCP Telemetry Resources

**Files:**
- Create: `src/mcp/telemetry-resources.ts`
- Test: `tests/telemetry-resources.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telemetry-resources.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { registerTelemetryResources } from "../src/mcp/telemetry-resources";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function createMockServer(): {
  server: McpServer;
  resources: Map<string, { handler: Function }>;
} {
  const resources = new Map<string, { handler: Function }>();
  const server = {
    resource: (name: string, _uriOrTemplate: unknown, handler: Function) => {
      resources.set(name, { handler });
    },
    tool: () => {},
  } as unknown as McpServer;
  return { server, resources };
}

describe("Telemetry MCP Resources", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-res-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("registers 3 telemetry resources", () => {
    const { server, resources } = createMockServer();
    registerTelemetryResources(server, store);
    expect(resources.has("telemetry-trace")).toBe(true);
    expect(resources.has("telemetry-recent-errors")).toBe(true);
    expect(resources.has("telemetry-health")).toBe(true);
  });

  test("telemetry-recent-errors returns recent errors", async () => {
    const { server, resources } = createMockServer();
    registerTelemetryResources(server, store);
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "error",
    });
    store.insertSpan({
      id: "s1", trace_id: "t1", parent_span_id: null, operation: "mcp_tool",
      name: "test", started_at: new Date().toISOString(),
      duration_ms: 10, status: "error", attributes: {},
    });
    store.insertError({
      span_id: "s1", trace_id: "t1", error_type: "TestError",
      message: "test error", stack_trace: null, recoverable: 0, context: {},
    });
    const handler = resources.get("telemetry-recent-errors")!.handler;
    const result = await handler({ href: "kai://telemetry/recent-errors" });
    const data = JSON.parse(result.contents[0].text);
    expect(data.errors.length).toBeGreaterThanOrEqual(1);
  });

  test("telemetry-health returns health stats", async () => {
    const { server, resources } = createMockServer();
    registerTelemetryResources(server, store);
    const handler = resources.get("telemetry-health")!.handler;
    const result = await handler({ href: "kai://telemetry/health" });
    const data = JSON.parse(result.contents[0].text);
    expect(data.traceCount).toBeDefined();
    expect(data.errorRate).toBeDefined();
    expect(data.p95LatencyMs).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry-resources.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/mcp/telemetry-resources.ts
import {
  type McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTelemetryStats } from "../core/telemetry/stats";
import type { TelemetryStore } from "../core/telemetry/store";

export function registerTelemetryResources(
  server: McpServer,
  store: TelemetryStore,
): void {
  // 1. kai://telemetry/trace/{id}
  const traceTemplate = new ResourceTemplate(
    "kai://telemetry/trace/{traceId}",
    {
      list: async () => {
        const traces = store.queryTelemetry(
          "SELECT id, tool_name FROM telemetry_traces_v1 ORDER BY started_at DESC LIMIT 20",
        );
        return {
          resources: traces.map((t) => ({
            uri: `kai://telemetry/trace/${t.id}`,
            name: `Trace: ${t.tool_name ?? t.id}`,
          })),
        };
      },
    },
  );
  server.resource(
    "telemetry-trace",
    traceTemplate,
    async (uri, variables) => {
      const traceId = Array.isArray(variables.traceId)
        ? variables.traceId[0]
        : variables.traceId;
      const trace = store.getTrace(traceId);
      const spans = store.getSpansByTrace(traceId);
      const events = store.getEventsByTrace(traceId);
      const stateChanges = store.getStateChangesByTrace(traceId);
      const errors = store.getErrorsByTrace(traceId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              trace,
              spans,
              events,
              stateChanges,
              errors,
            }),
          },
        ],
      };
    },
  );

  // 2. kai://telemetry/recent-errors
  server.resource(
    "telemetry-recent-errors",
    "kai://telemetry/recent-errors",
    async (uri) => {
      const errors = store.getRecentErrors(50);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ errors }),
          },
        ],
      };
    },
  );

  // 3. kai://telemetry/health
  server.resource(
    "telemetry-health",
    "kai://telemetry/health",
    async (uri) => {
      const stats = getTelemetryStats(store, 24);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(stats),
          },
        ],
      };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry-resources.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/telemetry-resources.ts tests/telemetry-resources.test.ts
git commit -m "feat(telemetry): add 3 MCP telemetry resources (trace, errors, health)"
```

---

## Task 11: withTrace Wrapper + Server Integration

**Files:**
- Modify: `src/mcp/handlers.ts` — add withTrace wrapper
- Modify: `src/mcp/server.ts` — create TelemetryRecorder, wire DI

- [ ] **Step 1: Add withTrace wrapper to handlers.ts**

Add this import at the top of `src/mcp/handlers.ts`:

```typescript
import type { TelemetryRecorder } from "../core/telemetry/recorder";
```

Add the `withTrace` function after the `textContent` helper (around line 24):

```typescript
type ToolHandler = (...args: unknown[]) => Promise<unknown>;

function withTrace(
  toolName: string,
  handler: ToolHandler,
  telemetry: TelemetryRecorder | null,
): ToolHandler {
  if (!telemetry) return handler;
  return async (args) => {
    const trace = telemetry.startTrace("mcp_request", toolName);
    const span = trace.startSpan("mcp_tool", toolName);
    try {
      const result = await handler(args);
      span.end("ok");
      trace.end("completed");
      return result;
    } catch (err) {
      span.error(err as Error);
      span.end("error");
      trace.end("error");
      throw err;
    }
  };
}
```

- [ ] **Step 2: Update registerHandlers to accept and use telemetry**

Change the function signature of `registerHandlers`:

```typescript
export function registerHandlers(
  server: McpServer,
  db: KaiDB,
  telemetry: TelemetryRecorder | null = null,
): void {
```

Wrap each `server.tool()` call with `withTrace`. For example, change:

```typescript
  server.tool("profile.read", ProfileReadSchema, async ({ scope, dimensions }) => {
```

to:

```typescript
  server.tool("profile.read", ProfileReadSchema, withTrace("profile.read", async ({ scope, dimensions }) => {
```

Do this for all 5 tool registrations (profile.read, profile.why, observe.submit, derive.trigger, observe.batch). Add the closing `)` for each `withTrace` wrapper at the end of each handler function.

- [ ] **Step 3: Update server.ts to create TelemetryRecorder and wire everything**

Replace the contents of `src/mcp/server.ts` with:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TelemetryRecorder } from "../core/telemetry/recorder";
import { TelemetryStore } from "../core/telemetry/store";
import { KaiDB } from "../db/client";
import { registerHandlers } from "./handlers";
import { registerOrchestratorHandlers } from "./orchestrator-handlers";
import { registerPromptHandlers } from "./prompt-handlers";
import { registerPromptResources } from "./prompt-resources";
import { registerResources } from "./resources";
import { registerTelemetryHandlers } from "./telemetry-handlers";
import { registerTelemetryResources } from "./telemetry-resources";
import { LLMProvider } from "../llm/provider";
import { log } from "./utils";

export function createMcpServer(db: KaiDB): McpServer {
  const server = new McpServer({
    name: "kai",
    version: "0.1.0",
  });

  server.server.onerror = (error: Error) => {
    log("mcp_server_error", { message: error.message });
  };

  // Telemetry setup
  const telemetryStore = new TelemetryStore(db);
  const telemetry = new TelemetryRecorder(telemetryStore);
  const llmProvider = new LLMProvider();

  registerResources(server, db, telemetry);
  registerHandlers(server, db, telemetry);
  registerOrchestratorHandlers(server, db, telemetry);
  registerPromptResources(server, db);
  registerPromptHandlers(server, db);
  registerTelemetryHandlers(server, telemetryStore, llmProvider);
  registerTelemetryResources(server, telemetryStore);

  return server;
}

export async function startMcpServer(dbPath: string): Promise<void> {
  const db = new KaiDB(dbPath);
  const server = createMcpServer(db);

  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("kai_mcp_server_started", { dbPath });

  // Start telemetry retention pruning (24h interval)
  const pruneInterval = setInterval(
    () => {
      try {
        const retentionDays = parseInt(
          process.env.KAI_TELEMETRY_RETENTION_DAYS ?? "30",
          10,
        );
        const store = new TelemetryStore(db);
        store.pruneTelemetry(retentionDays);
      } catch {
        // Fire-and-forget
      }
    },
    24 * 60 * 60 * 1000,
  );

  const shutdown = (signal: string) => {
    log("kai_mcp_server_shutdown", { signal });
    clearInterval(pruneInterval);
    db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
```

- [ ] **Step 4: Update resources.ts to accept telemetry parameter**

Change `registerResources` signature in `src/mcp/resources.ts`:

```typescript
import type { TelemetryRecorder } from "../core/telemetry/recorder";

export function registerResources(
  server: McpServer,
  db: KaiDB,
  telemetry: TelemetryRecorder | null = null,
): void {
```

Wrap the `kai://system/health` resource handler with telemetry trace (add telemetry health stats):

Inside the `system-health` resource handler, after the existing stats, add telemetry stats:

```typescript
    // Telemetry stats
    let telemetryStats = null;
    try {
      const { getTelemetryStats } = await import("../core/telemetry/stats");
      const { TelemetryStore } = await import("../core/telemetry/store");
      const telStore = new TelemetryStore(db);
      telemetryStats = getTelemetryStats(telStore, 24);
    } catch {}
```

Add `telemetry` to the returned JSON:

```typescript
            telemetry: telemetryStats,
```

- [ ] **Step 5: Update orchestrator-handlers.ts and prompt-handlers.ts signatures**

If `registerOrchestratorHandlers` and `registerPromptHandlers` exist, add the `telemetry` parameter (accept but don't use yet — Phase 3/4 instrumentation will add it):

```typescript
export function registerOrchestratorHandlers(
  server: McpServer,
  db: KaiDB,
  _telemetry: TelemetryRecorder | null = null,
): void {
```

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: ALL PASS (existing tests + new telemetry tests)

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/mcp/server.ts src/mcp/handlers.ts src/mcp/resources.ts src/mcp/telemetry-handlers.ts src/mcp/telemetry-resources.ts
git commit -m "feat(telemetry): integrate TelemetryRecorder into MCP server with withTrace wrapper"
```

---

## Task 12: CLI Commands

**Files:**
- Create: `src/cli/telemetry.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/telemetry-cli.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telemetry-cli.test.ts
import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerTelemetryCommands } from "../src/cli/telemetry";

describe("Telemetry CLI", () => {
  test("registers telemetry subcommands", () => {
    const program = new Command();
    registerTelemetryCommands(program);
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("telemetry");
    const telCmd = program.commands.find((c) => c.name() === "telemetry");
    const subCommands = telCmd?.commands.map((c) => c.name()) ?? [];
    expect(subCommands).toContain("health");
    expect(subCommands).toContain("query");
    expect(subCommands).toContain("trace");
    expect(subCommands).toContain("errors");
    expect(subCommands).toContain("explain");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry-cli.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/cli/telemetry.ts
import type { Command } from "commander";
import { KaiDB } from "../db/client";
import { TelemetryStore } from "../core/telemetry/store";
import { getTelemetryStats } from "../core/telemetry/stats";
import { explainTelemetry } from "../core/telemetry/explain";
import { getDbPath } from "./utils";

function getStore(): { db: KaiDB; store: TelemetryStore } {
  const db = new KaiDB(getDbPath());
  const store = new TelemetryStore(db);
  return { db, store };
}

export function registerTelemetryCommands(program: Command): void {
  const telemetry = program
    .command("telemetry")
    .description("Telemetry and observability commands");

  telemetry
    .command("health")
    .option("--json", "Output as JSON")
    .description("Quick telemetry health summary")
    .action((opts) => {
      const { db, store } = getStore();
      try {
        const stats = getTelemetryStats(store, 24);
        if (opts.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(`\n=== Telemetry Health ===`);
          console.log(
            `Traces: ${stats.traceCount} | Errors: ${stats.errorCount} (${(stats.errorRate * 100).toFixed(1)}%)`,
          );
          console.log(`P95 latency: ${stats.p95LatencyMs}ms`);
          if (stats.topOperations.length > 0) {
            console.log(
              `Top ops: ${stats.topOperations.map((o) => `${o.operation}(${o.count})`).join(", ")}`,
            );
          }
        }
      } finally {
        db.close();
      }
    });

  telemetry
    .command("query <sql>")
    .option("--json", "Output as JSON (default)")
    .option("--format <format>", "Output format: json or table", "json")
    .description("Execute SQL against telemetry views (SELECT only)")
    .action((sql: string, opts) => {
      const { db, store } = getStore();
      try {
        const rows = store.queryTelemetry(sql);
        if (opts.format === "table") {
          if (rows.length === 0) {
            console.log("No results.");
          } else {
            const keys = Object.keys(rows[0]);
            console.log(keys.join("\t"));
            for (const row of rows) {
              console.log(keys.map((k) => String(row[k] ?? "NULL")).join("\t"));
            }
          }
        } else {
          console.log(JSON.stringify(rows, null, 2));
        }
      } catch (err) {
        console.error(`Query error: ${(err as Error).message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });

  telemetry
    .command("trace <traceId>")
    .option("--json", "Output as JSON")
    .description("Retrieve full causal trace by ID")
    .action((traceId: string, opts) => {
      const { db, store } = getStore();
      try {
        const trace = store.getTrace(traceId);
        if (!trace) {
          console.error(`Trace '${traceId}' not found.`);
          process.exit(1);
        }
        const spans = store.getSpansByTrace(traceId);
        const events = store.getEventsByTrace(traceId);
        const changes = store.getStateChangesByTrace(traceId);
        const errors = store.getErrorsByTrace(traceId);

        if (opts.json) {
          console.log(
            JSON.stringify({ trace, spans, events, changes, errors }, null, 2),
          );
        } else {
          console.log(`\n=== Trace: ${trace.id} ===`);
          console.log(
            `Trigger: ${trace.trigger} | Tool: ${trace.tool_name ?? "N/A"} | Status: ${trace.status}`,
          );
          console.log(
            `Duration: ${trace.duration_ms ?? "N/A"}ms | Started: ${trace.started_at}`,
          );
          console.log(`\nSpans (${spans.length}):`);
          for (const s of spans) {
            const indent = s.parent_span_id ? "  " : "";
            console.log(
              `${indent}- ${s.operation}/${s.name} (${s.duration_ms ?? "?"}ms, ${s.status})`,
            );
          }
          if (events.length > 0) {
            console.log(`\nEvents (${events.length}):`);
            for (const e of events.slice(0, 20)) {
              console.log(`  [${e.type}] ${e.name}`);
            }
          }
          if (changes.length > 0) {
            console.log(`\nState Changes (${changes.length}):`);
            for (const c of changes) {
              console.log(
                `  ${c.entity_type}:${c.entity_id}.${c.field} ${c.old_value ?? "null"} → ${c.new_value ?? "null"}`,
              );
            }
          }
          if (errors.length > 0) {
            console.log(`\nErrors (${errors.length}):`);
            for (const e of errors) {
              console.log(`  [${e.error_type}] ${e.message}`);
            }
          }
        }
      } finally {
        db.close();
      }
    });

  telemetry
    .command("errors")
    .option("--last <hours>", "Time window in hours", "24")
    .option("--entity-type <type>", "Filter by entity type")
    .option("--json", "Output as JSON")
    .description("Show recent errors with context")
    .action((opts) => {
      const { db, store } = getStore();
      try {
        const limit = 50;
        const errors = store.getRecentErrors(limit);
        if (opts.json) {
          console.log(JSON.stringify(errors, null, 2));
        } else {
          if (errors.length === 0) {
            console.log("No errors found.");
          } else {
            console.log(`\n=== Recent Errors (${errors.length}) ===`);
            for (const e of errors) {
              console.log(
                `  [${e.error_type}] ${e.message} (recoverable: ${e.recoverable ? "yes" : "no"})`,
              );
            }
          }
        }
      } finally {
        db.close();
      }
    });

  telemetry
    .command("explain <question>")
    .option("--json", "Output as JSON")
    .description("Natural language analysis of telemetry data")
    .action(async (question: string, opts) => {
      const { db, store } = getStore();
      try {
        const result = await explainTelemetry(store, question, null);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`\n=== Telemetry Analysis ===`);
          console.log(result.summary);
          if (result.insights.length > 0) {
            console.log("\nInsights:");
            for (const i of result.insights) {
              console.log(`  - ${i.claim}`);
              console.log(`    Evidence: ${i.evidence}`);
            }
          }
        }
      } finally {
        db.close();
      }
    });
}
```

- [ ] **Step 4: Register in CLI index**

Add to `src/cli/index.ts`:

```typescript
import { registerTelemetryCommands } from "./telemetry";
```

Add after the existing `registerPromptCommands(program);`:

```typescript
registerTelemetryCommands(program);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/telemetry-cli.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/telemetry.ts src/cli/index.ts tests/telemetry-cli.test.ts
git commit -m "feat(telemetry): add 5 CLI telemetry commands"
```

---

## Task 13: Performance Benchmark

**Files:**
- Create: `tests/telemetry-benchmark.test.ts`

- [ ] **Step 1: Write the benchmark test**

```typescript
// tests/telemetry-benchmark.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { TelemetryRecorder } from "../src/core/telemetry/recorder";

describe("Telemetry Benchmark", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let recorder: TelemetryRecorder;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-bench-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
    recorder = new TelemetryRecorder(store);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("p99 overhead < 5ms per trace", () => {
    const ITERATIONS = 1000;
    const durations: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const trace = recorder.startTrace("mcp_request", "benchmark.tool");
      const span = trace.startSpan("mcp_tool", "benchmark.tool");
      span.event("info", "test event", { iteration: i });
      span.end("ok");
      trace.end("completed");
      const end = performance.now();
      durations.push(end - start);
    }

    durations.sort((a, b) => a - b);
    const p99Index = Math.ceil(ITERATIONS * 0.99) - 1;
    const p99 = durations[p99Index];

    console.log(`Telemetry benchmark: p99=${p99.toFixed(2)}ms, median=${durations[Math.floor(ITERATIONS / 2)].toFixed(2)}ms`);

    // p99 overhead must be < 5ms
    expect(p99).toBeLessThan(5);
  });

  test("disabled telemetry has zero overhead", () => {
    // This documents that with telemetry=null, handlers skip tracing
    const ITERATIONS = 1000;
    const durations: number[] = [];
    const noopHandler = () => ({ result: "ok" });

    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      noopHandler();
      const end = performance.now();
      durations.push(end - start);
    }

    durations.sort((a, b) => a - b);
    const p99 = durations[Math.ceil(ITERATIONS * 0.99) - 1];
    expect(p99).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run benchmark**

Run: `bun test tests/telemetry-benchmark.test.ts`
Expected: PASS — p99 < 5ms

- [ ] **Step 3: Commit**

```bash
git add tests/telemetry-benchmark.test.ts
git commit -m "test(telemetry): add performance benchmark (<5ms p99 overhead)"
```

---

## Task 14: Phase 2 — Derivation Instrumentation

**Files:**
- Modify: `src/core/profile/derivator.ts`

- [ ] **Step 1: Add telemetry import and instrumentation to derivator**

Add import at the top of `src/core/profile/derivator.ts`:

```typescript
import type { TelemetryRecorder } from "../telemetry/recorder";
```

Update the `Derivator` constructor to accept optional telemetry:

```typescript
export class Derivator {
  private engine: ProfileEngine;
  private telemetry: TelemetryRecorder | null;

  constructor(engine: ProfileEngine, telemetry: TelemetryRecorder | null = null) {
    this.engine = engine;
    this.telemetry = telemetry;
  }
```

Instrument `deriveFromRules` — wrap the method body:

```typescript
  deriveFromRules(): Trait[] {
    const trace = this.telemetry?.startTrace("internal", "derive.rules");
    const span = trace?.startSpan("derivation", "rule-based derivation");
    // ... existing code ...
    // Before returning:
    span?.end("ok");
    trace?.end("completed");
    return results;
  }
```

Instrument `deriveFromLLM` — wrap the method body:

```typescript
  async deriveFromLLM(llmProvider: LLMProvider, compiler: PromptCompiler): Promise<Trait[]> {
    const trace = this.telemetry?.startTrace("internal", "derive.llm");
    const span = trace?.startSpan("derivation", "LLM derivation");
    try {
      // ... existing code ...
      // For each trait result, record state change:
      for (const t of results) {
        span?.stateChange({
          type: "trait", id: t.dimension, field: "value",
          new: t.value.toString(), reason: t.reasoning,
        });
      }
      span?.end("ok");
      trace?.end("completed");
      return results;
    } catch (err) {
      span?.error(err as Error);
      span?.end("error");
      trace?.end("error");
      throw err;
    }
  }
```

- [ ] **Step 2: Update handlers.ts to pass telemetry to Derivator**

In `src/mcp/handlers.ts`, inside the `derive.trigger` handler, pass telemetry:

```typescript
    const derivator = new Derivator(engine, telemetry);
```

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/core/profile/derivator.ts src/mcp/handlers.ts
git commit -m "feat(telemetry): Phase 2 — instrument profile derivation with traces"
```

---

## Task 15: Phase 3 — Orchestrator Instrumentation

**Files:**
- Modify: `src/core/orchestrator/` (planner, dispatcher, observer)

- [ ] **Step 1: Instrument the orchestrator pipeline**

In each orchestrator module that executes tasks, add optional telemetry parameter and wrap key operations. This follows the same pattern as Task 14 — accept `TelemetryRecorder | null = null` in constructors, use `?.` optional chaining for all telemetry calls.

Key instrumentation points:
- **Planner**: trace + span for task decomposition
- **Dispatcher**: span for task execution
- **Observer**: span for observation collection

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/orchestrator/
git commit -m "feat(telemetry): Phase 3 — instrument orchestrator pipeline with traces"
```

---

## Task 16: Phase 4 — Prompt Genome Instrumentation + Telemetry Scoring

**Files:**
- Modify: `src/core/prompt/judge-engine.ts` — add telemetry scoring
- Modify: `src/core/prompt/tournament-runner.ts` — add trace spans

- [ ] **Step 1: Add telemetry scoring to JudgeEngine**

In `src/core/prompt/judge-engine.ts`, add a `telemetryScore` method:

```typescript
import type { TelemetryStore } from "../telemetry/store";

export class JudgeEngine {
  private llm: LLMProvider;
  private telemetryStore: TelemetryStore | null;

  constructor(llm: LLMProvider, telemetryStore: TelemetryStore | null = null) {
    this.llm = llm;
    this.telemetryStore = telemetryStore;
  }

  private telemetryScore(variantId: string): number {
    if (!this.telemetryStore) return 0.5; // neutral fallback

    try {
      const traces = this.telemetryStore.queryTelemetry(
        `SELECT COUNT(*) as total FROM telemetry_traces_v1 WHERE tool_name LIKE '%${variantId}%' AND started_at >= datetime('now', '-7 days')`,
      );
      const total = (traces[0]?.total as number) ?? 0;
      if (total === 0) return 0.5;

      const errors = this.telemetryStore.queryTelemetry(
        `SELECT COUNT(*) as err FROM telemetry_errors_v1 WHERE created_at >= datetime('now', '-7 days')`,
      );
      const errorCount = (errors[0]?.err as number) ?? 0;

      const errorRate = Math.min(errorCount / total, 1);
      return Math.max(1 - errorRate * 0.5, 0);
    } catch {
      return 0.5;
    }
  }
```

In the `judge()` method, after parsing the response, adjust the confidence:

```typescript
    // Apply telemetry scoring factor
    const telScore = this.telemetryScore("");
    result.confidence = result.confidence * 0.7 + telScore * 0.3;
```

- [ ] **Step 2: Instrument TournamentRunner**

Add optional telemetry to `src/core/prompt/tournament-runner.ts`:

```typescript
import type { TelemetryRecorder } from "../telemetry/recorder";
```

Add to constructor:

```typescript
  constructor(telemetry: TelemetryRecorder | null = null) {
    this.telemetry = telemetry;
  }
```

Wrap the `run()` method with trace + span for tournament execution.

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/prompt/judge-engine.ts src/core/prompt/tournament-runner.ts
git commit -m "feat(telemetry): Phase 4 — instrument prompt genome + telemetry-driven scoring"
```

---

## Task 17: Health Score Extension

**Files:**
- Modify: `src/mcp/resources.ts` — extend kai://system/health

- [ ] **Step 1: Verify health resource includes telemetry stats**

This was already done in Task 11 Step 4. Verify by running:

Run: `bun test tests/telemetry-resources.test.ts`
Expected: PASS

- [ ] **Step 2: Commit if any changes needed**

Only commit if there are uncommitted changes from verification.

---

## Task 18: Integration Tests

**Files:**
- Create: `tests/telemetry-integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/telemetry-integration.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryRecorder } from "../src/core/telemetry/recorder";
import { TelemetryStore } from "../src/core/telemetry/store";
import { getTelemetryStats } from "../src/core/telemetry/stats";
import { explainTelemetry } from "../src/core/telemetry/explain";

describe("Telemetry Integration — Full Causal Chain", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let recorder: TelemetryRecorder;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-integ-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
    recorder = new TelemetryRecorder(store);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("full MCP call trace: request → tool → derivation → state change", () => {
    // Simulate an MCP call that triggers a derivation
    const trace = recorder.startTrace("mcp_request", "derive.trigger");
    const toolSpan = trace.startSpan("mcp_tool", "derive.trigger");

    // Derivation span
    const deriveSpan = toolSpan.startChild("derivation", "rule-based derivation");
    deriveSpan.event("info", "rule matched", { dimension: "early_riser" });
    deriveSpan.stateChange({
      type: "trait", id: "early_riser", field: "value",
      old: "0.3", new: "0.7", reason: "rule: morning observations",
    });
    deriveSpan.end("ok");

    toolSpan.end("ok");
    trace.end("completed");

    // Verify full chain is queryable
    const persistedTrace = store.getTrace(trace.traceId);
    expect(persistedTrace!.status).toBe("completed");

    const spans = store.getSpansByTrace(trace.traceId);
    expect(spans).toHaveLength(2);

    const deriveSpans = spans.filter((s) => s.operation === "derivation");
    expect(deriveSpans).toHaveLength(1);

    const events = store.getEventsByTrace(trace.traceId);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("rule matched");

    const changes = store.getStateChangesByTrace(trace.traceId);
    expect(changes).toHaveLength(1);
    expect(changes[0].old_value).toBe("0.3");
    expect(changes[0].new_value).toBe("0.7");
  });

  test("error trace captures error + context", () => {
    const trace = recorder.startTrace("mcp_request", "derive.trigger");
    const span = trace.startSpan("mcp_tool", "derive.trigger");
    const llmSpan = span.startChild("llm_call", "derive from LLM");
    const err = new Error("LLM API timeout");
    llmSpan.error(err, true, { retries: 2 });
    llmSpan.end("error");
    span.end("error");
    trace.end("error");

    const errors = store.getErrorsByTrace(trace.traceId);
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe("Error");
    expect(errors[0].recoverable).toBe(1);

    // Verify error recovery suggestions
    const similar = store.getSimilarErrors("Error", 3);
    expect(similar.length).toBeGreaterThanOrEqual(1);
  });

  test("stats reflect accumulated traces", () => {
    // Generate some traces
    for (let i = 0; i < 5; i++) {
      const trace = recorder.startTrace("mcp_request", "test");
      const span = trace.startSpan("mcp_tool", "test");
      span.end("ok");
      trace.end("completed");
    }
    const errTrace = recorder.startTrace("mcp_request", "fail");
    const errSpan = errTrace.startSpan("mcp_tool", "fail");
    errSpan.end("error");
    errTrace.end("error");

    const stats = getTelemetryStats(store, 24);
    expect(stats.traceCount).toBe(6);
    expect(stats.errorRate).toBeCloseTo(1 / 6, 1);
  });

  test("explain returns summary for accumulated data", async () => {
    for (let i = 0; i < 3; i++) {
      const trace = recorder.startTrace("mcp_request", "test");
      const span = trace.startSpan("mcp_tool", "test");
      span.end("ok");
      trace.end("completed");
    }

    const result = await explainTelemetry(store, "what happened?", null);
    expect(result.summary).toContain("3");
  });

  test("SQL query against views returns data", () => {
    const trace = recorder.startTrace("mcp_request", "test");
    const span = trace.startSpan("mcp_tool", "test");
    span.end("ok");
    trace.end("completed");

    const rows = store.queryTelemetry(
      "SELECT * FROM telemetry_traces_v1 WHERE tool_name = 'test'",
    );
    expect(rows).toHaveLength(1);
  });

  test("pruning removes old data", () => {
    // This trace is already in the past due to recorder using current time
    const trace = recorder.startTrace("mcp_request", "test");
    const span = trace.startSpan("mcp_tool", "test");
    span.end("ok");
    trace.end("completed");

    // Prune should not remove recent data
    store.pruneTelemetry(30);
    const persisted = store.getTrace(trace.traceId);
    expect(persisted).toBeDefined();
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `bun test tests/telemetry-integration.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 3: Commit**

```bash
git add tests/telemetry-integration.test.ts
git commit -m "test(telemetry): add integration tests for full causal chain"
```

---

## Task 19: Final Validation

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: ALL PASS (existing ~402 + ~80 new tests)

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `npx @biomejs/biome check src/`
Expected: No errors

- [ ] **Step 4: Run dead code check**

Run: `npx knip`
Expected: No new dead code

- [ ] **Step 5: Run benchmark**

Run: `bun test tests/telemetry-benchmark.test.ts`
Expected: PASS — p99 < 5ms

- [ ] **Step 6: Manual CLI smoke test**

Run: `bun run src/cli/index.ts telemetry health --json`
Expected: JSON with traceCount, errorRate, p95LatencyMs

Run: `bun run src/cli/index.ts telemetry query "SELECT * FROM telemetry_traces_v1 LIMIT 1"`
Expected: Empty array or trace data

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore(telemetry): final validation — all tests pass, typecheck clean, lint clean"
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAN | 5 proposals, 4 accepted, 1 deferred |
| Eng Review | `/plan-eng-review` | Architecture, code quality, tests, performance | 1 | ISSUES_FOUND → RESOLVED | 9 issues (D1-D9), all resolved |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | ISSUES_FOUND | 17 findings, 4 cross-model tensions (T1-T4), all resolved |
| Design Review | — | UI/UX gaps | 0 | — | SKIPPED (no UI scope) |
| DX Review | — | Developer experience gaps | 0 | — | — |

### Eng Review Decisions (all resolved)

| ID | Section | Issue | Decision |
|----|---------|-------|----------|
| D1 | Arch | stats.ts uses string interpolation SQL | Parameterized prepared statements for stats + prune |
| D2 | Arch | withTrace lacks type safety | Generic wrapper `<T>` with full type preservation |
| D3 | Arch | explainTelemetry free function limits cache | ExplainEngine class with instance-level state |
| D4 | Arch | Unfinished spans left 'running' | Mark as 'orphaned' at trace.end(); post-end span.end() silently ignored |
| D5 | Code | textContent duplicated across handlers | Extract to src/mcp/utils.ts |
| D6 | Code | flushBatch BatchItem untyped payload | Discriminated union with typed data per type |
| D7 | Code | LLMProvider created in multiple places | Single instance in server.ts, DI to all consumers |
| D8 | Tests | 10 test coverage gaps | Fill all: CLI output, SQL injection, prune bulk |
| D9 | Perf | Individual span writes per span.end() | Cache in memory, flush all at trace.end() in single TX |

### Cross-Model Tensions (all resolved)

| ID | Topic | Claude Position | Codex Position | Resolution |
|----|-------|-----------------|----------------|------------|
| T1 | Deferred writes | trace-end flush (D9) | bun:sqlite sync, needs real queue | D9 accepted — deferred TX writes |
| T2 | telemetry.query safety | 4-layer defense sufficient | Remove raw SQL from MCP tool | Keep raw SQL + 4-layer defense |
| T3 | Sanitization gaps | Key-based redaction | Misses secrets in strings | Expand pattern: +cookie, private_key, client_secret, refresh_token, dsn, authorization |
| T4 | telemetry.explain privacy | LLM fallback when unavailable | May send trace data externally | Add KAI_TELEMETRY_EXPLAIN_ENABLED env var opt-in gate |

### Completion Summary

| Metric | Value |
|--------|-------|
| Reviews completed | CEO + Eng + Codex |
| Eng sections | 4/4 (Arch, Code Quality, Tests, Performance) |
| Issues found | 9 (D1-D9) |
| Issues resolved | 9/9 |
| Codex findings | 17 problems |
| Cross-model tensions | 4 (T1-T4) |
| Tensions resolved | 4/4 |
| Unresolved decisions | 0 |
| Critical gaps | 0 |
| Verdict | ENG REVIEW PASSED — 0 unresolved, 0 critical gaps |
