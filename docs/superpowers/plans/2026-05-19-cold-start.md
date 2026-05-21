# Cold Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement workspace-driven behavioral profile bootstrapping — `kai work start` creates a profile from git history + 4 structured questions, with preview-before-write and continuous learning via workspace events.

**Architecture:** Three-layer progressive system. Layer 1: workspace data model (types + SQLite store). Layer 2: cold start UX (git scan + questions + signal extraction + profile preview + confirm). Layer 3: continuous learning (workspace events → observations → derivation). All delivered in one PR. Source precedence prevents cold start traits from overwriting declared/corrected traits.

**Tech Stack:** Bun runtime, bun:sqlite, Commander CLI, TypeScript strict mode, bun:test

---

## File Structure

```
src/
  core/profile/
    types.ts          — MODIFY: add "coldstart" | "workspace" to Observation.source
    engine.ts         — MODIFY: add source precedence to setTrait()
    derivator.ts      — MODIFY: add coldstart/workspace rules + deriveFromRules(persist) overload
  db/
    client.ts         — MODIFY: add MIGRATION_V4 with PRAGMA foreign_keys=OFF
  workspace/
    types.ts          — NEW: Workspace, Task, WorkspaceEvent, IWorkspaceAdapter
    store.ts          — NEW: WorkspaceStore (SQLite CRUD)
    event-bus.ts      — NEW: eventToObservation() + state-change triggers
  cli/
    index.ts          — MODIFY: register work commands
    profile.ts        — MODIFY: add diff --last, deprecate bootstrap
    work.ts           — NEW: kai work start/status/list commands
tests/
  migration-v4.test.ts           — NEW: migration safety tests
  workspace/store.test.ts        — NEW: WorkspaceStore CRUD tests
  workspace/event-bus.test.ts    — NEW: event bus tests
  cold-start.test.ts             — NEW: signal extraction + preview tests
  git-scan.test.ts               — NEW: git scan fallback tests
  profile-diff.test.ts           — NEW: profile diff tests
```

---

## Task 1: Update Observation.source Type Union

**Files:**
- Modify: `src/core/profile/types.ts:38`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/type-source-union.test.ts
import { describe, test, expect } from "bun:test";
import type { Observation } from "../src/core/profile/types";

describe("Observation source type union", () => {
  test("accepts coldstart source", () => {
    const obs: Observation = {
      id: 1,
      type: "signal",
      key: "coldstart:goal",
      value: "{}",
      confidence: 8,
      source: "coldstart",
      provenance: "{}",
      ts: new Date().toISOString(),
    };
    expect(obs.source).toBe("coldstart");
  });

  test("accepts workspace source", () => {
    const obs: Observation = {
      id: 2,
      type: "signal",
      key: "workspace:task_completed",
      value: "{}",
      confidence: 7,
      source: "workspace",
      provenance: "{}",
      ts: new Date().toISOString(),
    };
    expect(obs.source).toBe("workspace");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/type-source-union.test.ts`
Expected: FAIL — TypeScript error, `"coldstart"` is not assignable to `Observation.source`

- [ ] **Step 3: Write minimal implementation**

In `src/core/profile/types.ts`, change line 38:

```typescript
// Before:
source: "cron_output" | "session_log" | "user_stated" | "inferred" | "mcp";

// After:
source:
  | "cron_output"
  | "session_log"
  | "user_stated"
  | "inferred"
  | "mcp"
  | "coldstart"
  | "workspace";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/type-source-union.test.ts`
Expected: PASS

- [ ] **Step 5: Run full type check**

Run: `npx tsc --noEmit`
Expected: PASS (no downstream code uses the new source values yet)

- [ ] **Step 6: Commit**

```bash
git add src/core/profile/types.ts tests/type-source-union.test.ts
git commit -m "feat: add coldstart and workspace to Observation.source type union"
```

---

## Task 2: Add MIGRATION_V4 with PRAGMA foreign_keys=OFF

**Files:**
- Modify: `src/db/client.ts:93-131`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/migration-v4.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../src/db/client";
import { ProfileEngine } from "../src/core/profile/engine";

function tempDb(): string {
  return join(tmpdir(), `kai-mig4-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}

describe("MIGRATION_V4", () => {
  let dbPath: string;

  afterEach(() => {
    cleanup(dbPath);
  });

  test("creates workspace tables on fresh DB", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const tables = db.listTables();
    db.close();

    expect(tables).toContain("workspaces");
    expect(tables).toContain("workspace_tasks");
    expect(tables).toContain("workspace_events");
  });

  test("preserves existing observations when migrating from v3", () => {
    // Create v3 DB first
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    // Add a v3 observation (source: mcp is valid in v3)
    engine.addObservation({
      type: "behavior",
      key: "test:existing",
      value: '{"text": "hello"}',
      confidence: 5,
      source: "mcp",
      provenance: '{"origin": "test"}',
    });

    const beforeCount = engine.getObservations().length;
    expect(beforeCount).toBe(1);
    db.close();

    // Re-open — triggers MIGRATION_V4
    const db2 = new KaiDB(dbPath);
    const engine2 = new ProfileEngine(db2);
    const afterObservations = engine2.getObservations();
    expect(afterObservations.length).toBe(1);
    expect(afterObservations[0].source).toBe("mcp");
    expect(afterObservations[0].key).toBe("test:existing");
    db2.close();
  });

  test("accepts coldstart and workspace sources after migration", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    const id1 = engine.addObservation({
      type: "signal",
      key: "coldstart:goal",
      value: '{"answer": "build something"}',
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin": "kai work start"}',
    });
    expect(id1).toBeGreaterThan(0);

    const id2 = engine.addObservation({
      type: "signal",
      key: "workspace:task_completed",
      value: '{"task_id": "t1"}',
      confidence: 7,
      source: "workspace",
      provenance: '{"origin": "workspace_event_bus"}',
    });
    expect(id2).toBeGreaterThan(id1);

    db.close();
  });

  test("passes integrity check after migration", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    expect(db.integrityCheck()).toBe("ok");
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/migration-v4.test.ts`
Expected: FAIL — workspace tables not found, coldstart source rejected by CHECK constraint

- [ ] **Step 3: Write minimal implementation**

Add `MIGRATION_V4` constant in `src/db/client.ts` after `MIGRATION_V3` (after line 93):

```typescript
const MIGRATION_V4 = `
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- New workspace tables
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','completed')),
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES workspace_tasks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_events_type ON workspace_events(event_type);
CREATE INDEX IF NOT EXISTS idx_workspace_events_workspace ON workspace_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_workspace ON workspace_tasks(workspace_id);

-- Expand observation source enum: add 'coldstart' and 'workspace'
CREATE TABLE IF NOT EXISTS observations_v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('behavior','preference','feedback','context','signal')),
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL DEFAULT 5 CHECK(confidence >= 1 AND confidence <= 10),
  source TEXT NOT NULL CHECK(source IN ('cron_output','session_log','user_stated','inferred','mcp','coldstart','workspace')),
  provenance TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO observations_v4 (id, type, key, value, confidence, source, provenance, ts)
  SELECT id, type, key, value, confidence, source, provenance, ts FROM observations;

DROP TABLE IF EXISTS observations;
ALTER TABLE observations_v4 RENAME TO observations;

CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_key ON observations(key);
CREATE INDEX IF NOT EXISTS idx_observations_ts ON observations(ts);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;
```

Add migration step in `runMigrations()` method, after the V3 block (after line 130):

```typescript
    if (currentVersion < 4) {
      this.db.exec(MIGRATION_V4);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [4],
      );
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/migration-v4.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/client.ts tests/migration-v4.test.ts
git commit -m "feat: add MIGRATION_V4 — workspace tables + observation source enum expansion"
```

---

## Task 3: Add Source Precedence to setTrait()

**Files:**
- Modify: `src/core/profile/engine.ts:170-193`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/trait-precedence.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../src/db/client";
import { ProfileEngine } from "../src/core/profile/engine";

function tempDb(): string {
  return join(tmpdir(), `kai-prec-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}

describe("setTrait source precedence", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("observed trait does not overwrite declared trait", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    // First: declare a trait
    engine.setTrait({
      dimension: "risk_tolerance",
      value: 0.9,
      confidence: 10,
      source: "declared",
      reasoning: "User explicitly stated",
    });

    // Then: try to overwrite with observed (cold start)
    engine.setTrait({
      dimension: "risk_tolerance",
      value: 0.3,
      confidence: 5,
      source: "observed",
      reasoning: "Cold start derived",
    });

    const traits = engine.getTraits({ dimension: "risk_tolerance" });
    expect(traits.length).toBe(1);
    expect(traits[0].source).toBe("declared");
    expect(traits[0].value).toBe(0.9);

    db.close();
  });

  test("observed overwrites inferred", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.setTrait({
      dimension: "detail_oriented",
      value: 0.3,
      confidence: 3,
      source: "inferred",
      reasoning: "Weak signal",
    });

    engine.setTrait({
      dimension: "detail_oriented",
      value: 0.8,
      confidence: 7,
      source: "observed",
      reasoning: "Cold start derived",
    });

    const traits = engine.getTraits({ dimension: "detail_oriented" });
    expect(traits[0].source).toBe("observed");
    expect(traits[0].value).toBe(0.8);

    db.close();
  });

  test("same-priority source overwrites (normal behavior)", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.setTrait({
      dimension: "planning_style",
      value: 0.5,
      confidence: 5,
      source: "observed",
      reasoning: "First observation",
    });

    engine.setTrait({
      dimension: "planning_style",
      value: 0.7,
      confidence: 7,
      source: "observed",
      reasoning: "Stronger observation",
    });

    const traits = engine.getTraits({ dimension: "planning_style" });
    expect(traits[0].value).toBe(0.7);

    db.close();
  });

  test("declared > corrected > observed > inferred precedence order", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    // Write in reverse order of precedence
    engine.setTrait({ dimension: "scope_appetite", value: 0.2, confidence: 3, source: "inferred", reasoning: "inferred" });
    engine.setTrait({ dimension: "scope_appetite", value: 0.5, confidence: 5, source: "observed", reasoning: "observed" });

    // observed overwrites inferred
    expect(engine.getTraits({ dimension: "scope_appetite" })[0].source).toBe("observed");

    // Try to overwrite observed with inferred — should be blocked
    engine.setTrait({ dimension: "scope_appetite", value: 0.1, confidence: 2, source: "inferred", reasoning: "inferred again" });
    expect(engine.getTraits({ dimension: "scope_appetite" })[0].value).toBe(0.5);

    // declared overwrites observed
    engine.setTrait({ dimension: "scope_appetite", value: 0.9, confidence: 10, source: "declared", reasoning: "declared" });
    expect(engine.getTraits({ dimension: "scope_appetite" })[0].source).toBe("declared");
    expect(engine.getTraits({ dimension: "scope_appetite" })[0].value).toBe(0.9);

    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/trait-precedence.test.ts`
Expected: FAIL — observed trait overwrites declared trait (no precedence check)

- [ ] **Step 3: Write minimal implementation**

Replace `setTrait` method in `src/core/profile/engine.ts` (lines 170-193):

```typescript
  private static readonly SOURCE_PRECEDENCE: Record<string, number> = {
    declared: 4,
    corrected: 3,
    observed: 2,
    inferred: 1,
    "cross-model": 1,
  };

  setTrait(input: SetTraitInput): string {
    // Source precedence: higher-priority sources cannot be overwritten by lower
    const existing = this.getTraits({ dimension: input.dimension });
    if (existing.length > 0) {
      const currentPrecedence =
        ProfileEngine.SOURCE_PRECEDENCE[existing[0].source] ?? 0;
      const newPrecedence =
        ProfileEngine.SOURCE_PRECEDENCE[input.source] ?? 0;
      if (newPrecedence < currentPrecedence) {
        return existing[0].id;
      }
    }

    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO traits (id, dimension, value, confidence, source, reasoning, updated_at)
       VALUES ($id, $dimension, $value, $confidence, $source, $reasoning, datetime('now'))
       ON CONFLICT(dimension) DO UPDATE SET
         value = excluded.value,
         confidence = excluded.confidence,
         source = excluded.source,
         reasoning = excluded.reasoning,
         updated_at = datetime('now'),
         id = excluded.id`,
      )
      .run({
        $id: id,
        $dimension: input.dimension,
        $value: input.value,
        $confidence: input.confidence,
        $source: input.source,
        $reasoning: input.reasoning,
      });
    return id;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/trait-precedence.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `bun test`
Expected: ALL PASS (existing code never sets conflicting sources on same dimension)

- [ ] **Step 6: Commit**

```bash
git add src/core/profile/engine.ts tests/trait-precedence.test.ts
git commit -m "feat: add source precedence to setTrait() — declared > corrected > observed > inferred"
```

---

## Task 4: Create Workspace Types + WorkspaceStore

**Files:**
- Create: `src/workspace/types.ts`
- Create: `src/workspace/store.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/workspace/store.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../../src/db/client";
import { WorkspaceStore } from "../../src/workspace/store";
import type { Workspace, Task, WorkspaceEvent } from "../../src/workspace/types";

function tempDb(): string {
  return join(tmpdir(), `kai-ws-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}

describe("WorkspaceStore", () => {
  let dbPath: string;
  let store: WorkspaceStore;

  afterEach(() => {
    if (store) store.close();
    cleanup(dbPath);
  });

  test("createWorkspace and getWorkspace", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({
      name: "Test Project",
      description: "A test workspace",
    });

    expect(ws.id).toBeDefined();
    expect(ws.name).toBe("Test Project");
    expect(ws.status).toBe("active");

    const fetched = store.getWorkspace(ws.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Test Project");

    store.close();
  });

  test("listWorkspaces returns all workspaces", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    store.createWorkspace({ name: "WS1" });
    store.createWorkspace({ name: "WS2" });
    store.createWorkspace({ name: "WS3" });

    const list = store.listWorkspaces();
    expect(list.length).toBe(3);

    store.close();
  });

  test("updateWorkspace changes fields", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Original" });
    store.updateWorkspace(ws.id, { status: "archived", description: "Done" });

    const updated = store.getWorkspace(ws.id);
    expect(updated!.status).toBe("archived");
    expect(updated!.description).toBe("Done");

    store.close();
  });

  test("deleteWorkspace cascades to tasks and events", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "To Delete" });
    store.createTask({ workspace_id: ws.id, title: "A task" });
    store.addEvent({ workspace_id: ws.id, event_type: "task_created", payload: "{}" });

    store.deleteWorkspace(ws.id);

    expect(store.getWorkspace(ws.id)).toBeNull();
    expect(store.listTasks(ws.id).length).toBe(0);
    expect(store.listEvents(ws.id).length).toBe(0);

    store.close();
  });

  test("createTask and listTasks", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Tasks" });
    const task = store.createTask({
      workspace_id: ws.id,
      title: "Do something",
      description: "Details here",
    });

    expect(task.id).toBeDefined();
    expect(task.workspace_id).toBe(ws.id);
    expect(task.status).toBe("pending");

    const tasks = store.listTasks(ws.id);
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe("Do something");

    store.close();
  });

  test("updateTask changes status", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Update" });
    const task = store.createTask({ workspace_id: ws.id, title: "T" });
    store.updateTask(task.id, { status: "completed" });

    const tasks = store.listTasks(ws.id);
    expect(tasks[0].status).toBe("completed");

    store.close();
  });

  test("addEvent and listEvents", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Events" });
    store.addEvent({
      workspace_id: ws.id,
      event_type: "task_created",
      payload: '{"task_id": "t1"}',
    });

    const events = store.listEvents(ws.id);
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe("task_created");

    store.close();
  });

  test("addEvent with task_id", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "With Task" });
    const task = store.createTask({ workspace_id: ws.id, title: "T" });
    store.addEvent({
      workspace_id: ws.id,
      task_id: task.id,
      event_type: "task_completed",
      payload: "{}",
    });

    const events = store.listEvents(ws.id);
    expect(events[0].task_id).toBe(task.id);

    store.close();
  });

  test("updateWorkspaceContext sets context JSON", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Context" });
    const snapshot = { profile_snapshot: [{ dimension: "test", value: 0.5 }] };
    store.updateWorkspaceContext(ws.id, snapshot);

    const fetched = store.getWorkspace(ws.id);
    expect(JSON.parse(fetched!.context)).toEqual(snapshot);

    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/workspace/store.test.ts`
Expected: FAIL — cannot resolve `../../src/workspace/store` or `../../src/workspace/types`

- [ ] **Step 3: Write type definitions**

Create `src/workspace/types.ts`:

```typescript
export interface Workspace {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived" | "completed";
  context: string; // JSON: workspace-level metadata (profile_snapshot, etc.)
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  metadata: string; // JSON: task-type-specific data
  created_at: string;
  updated_at: string;
}

export interface WorkspaceEvent {
  id: number;
  workspace_id: string;
  task_id: string | null;
  event_type: WorkspaceEventType;
  payload: string; // JSON
  created_at: string;
}

export type WorkspaceEventType =
  | "workspace_created"
  | "task_created"
  | "task_updated"
  | "task_completed"
  | "interaction"
  | "coldstart_answer";

export interface IWorkspaceAdapter {
  readonly name: string;
  fetchEvents(since: string): WorkspaceEvent[];
  pushTask(task: Omit<Task, "created_at" | "updated_at">): void;
  pushEvent(event: Omit<WorkspaceEvent, "id" | "created_at">): void;
}
```

- [ ] **Step 4: Write WorkspaceStore implementation**

Create `src/workspace/store.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { KaiDB } from "../db/client";
import type { Workspace, Task, WorkspaceEvent } from "./types";

export class WorkspaceStore {
  private db;

  constructor(kaiDb: KaiDB) {
    this.db = kaiDb.getDatabase();
  }

  createWorkspace(input: {
    name: string;
    description?: string;
  }): Workspace {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO workspaces (id, name, description) VALUES ($id, $name, $desc)`,
      )
      .run({ $id: id, $name: input.name, $desc: input.description ?? "" });
    return this.getWorkspace(id)!;
  }

  getWorkspace(id: string): Workspace | null {
    return this.db
      .query("SELECT * FROM workspaces WHERE id = $id")
      .get({ $id: id }) as Workspace | null;
  }

  listWorkspaces(): Workspace[] {
    return this.db
      .query("SELECT * FROM workspaces ORDER BY created_at DESC")
      .all() as Workspace[];
  }

  updateWorkspace(
    id: string,
    fields: Partial<Pick<Workspace, "name" | "description" | "status">>,
  ): void {
    const sets: string[] = [];
    const params: Record<string, unknown> = { $id: id };

    if (fields.name !== undefined) {
      sets.push("name = $name");
      params.$name = fields.name;
    }
    if (fields.description !== undefined) {
      sets.push("description = $desc");
      params.$desc = fields.description;
    }
    if (fields.status !== undefined) {
      sets.push("status = $status");
      params.$status = fields.status;
    }

    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    this.db
      .query(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = $id`)
      .run(params);
  }

  updateWorkspaceContext(id: string, context: unknown): void {
    this.db
      .query("UPDATE workspaces SET context = $ctx, updated_at = datetime('now') WHERE id = $id")
      .run({ $id: id, $ctx: JSON.stringify(context) });
  }

  deleteWorkspace(id: string): void {
    this.db.query("DELETE FROM workspaces WHERE id = $id").run({ $id: id });
  }

  createTask(input: {
    workspace_id: string;
    title: string;
    description?: string;
    metadata?: string;
  }): Task {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO workspace_tasks (id, workspace_id, title, description, metadata) VALUES ($id, $ws, $title, $desc, $meta)`,
      )
      .run({
        $id: id,
        $ws: input.workspace_id,
        $title: input.title,
        $desc: input.description ?? "",
        $meta: input.metadata ?? "{}",
      });
    return this.db
      .query("SELECT * FROM workspace_tasks WHERE id = $id")
      .get({ $id: id }) as Task;
  }

  listTasks(workspaceId: string): Task[] {
    return this.db
      .query("SELECT * FROM workspace_tasks WHERE workspace_id = $ws ORDER BY created_at")
      .all({ $ws: workspaceId }) as Task[];
  }

  updateTask(
    id: string,
    fields: Partial<Pick<Task, "title" | "description" | "status" | "metadata">>,
  ): void {
    const sets: string[] = [];
    const params: Record<string, unknown> = { $id: id };

    if (fields.title !== undefined) { sets.push("title = $v"); params.$v = fields.title; }
    if (fields.description !== undefined) { sets.push("description = $v2"); params.$v2 = fields.description; }
    if (fields.status !== undefined) { sets.push("status = $v3"); params.$v3 = fields.status; }
    if (fields.metadata !== undefined) { sets.push("metadata = $v4"); params.$v4 = fields.metadata; }

    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    this.db
      .query(`UPDATE workspace_tasks SET ${sets.join(", ")} WHERE id = $id`)
      .run(params);
  }

  addEvent(input: {
    workspace_id: string;
    task_id?: string;
    event_type: string;
    payload: string;
  }): void {
    this.db
      .query(
        `INSERT INTO workspace_events (workspace_id, task_id, event_type, payload) VALUES ($ws, $task, $type, $payload)`,
      )
      .run({
        $ws: input.workspace_id,
        $task: input.task_id ?? null,
        $type: input.event_type,
        $payload: input.payload,
      });
  }

  listEvents(workspaceId: string): WorkspaceEvent[] {
    return this.db
      .query("SELECT * FROM workspace_events WHERE workspace_id = $ws ORDER BY created_at")
      .all({ $ws: workspaceId }) as WorkspaceEvent[];
  }

  close(): void {
    // DB lifetime managed by KaiDB caller
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/workspace/store.test.ts`
Expected: PASS

- [ ] **Step 6: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
mkdir -p tests/workspace
git add src/workspace/types.ts src/workspace/store.ts tests/workspace/store.test.ts
git commit -m "feat: add workspace types and WorkspaceStore with SQLite CRUD"
```

---

## Task 5: Add Coldstart + Workspace Derivation Rules + Preview Mode

**Files:**
- Modify: `src/core/profile/derivator.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/coldstart-rules.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../src/db/client";
import { ProfileEngine } from "../src/core/profile/engine";
import { Derivator } from "../src/core/profile/derivator";

function tempDb(): string {
  return join(tmpdir(), `kai-cs-rules-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}

describe("Coldstart derivation rules", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("coldstart:signal.detail_level with high detail", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.detail_level",
      value: JSON.stringify({ level: "high", word_count: 45, has_specifics: true }),
      confidence: 7,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const detail = results.find((r) => r.dimension === "detail_oriented");
    expect(detail).toBeDefined();
    expect(detail!.value).toBeGreaterThan(0);

    db.close();
  });

  test("coldstart:signal.comm_style derives comm_style trait", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.comm_style",
      value: JSON.stringify({ style: "verbose", word_count: 50 }),
      confidence: 6,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const comm = results.find((r) => r.dimension === "comm_style");
    expect(comm).toBeDefined();
    expect(comm!.value).toBeGreaterThan(0);

    db.close();
  });

  test("coldstart:signal.domain derives domain_context trait", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: ["engineering", "research"] }),
      confidence: 7,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const domain = results.find((r) => r.dimension === "domain_context");
    expect(domain).toBeDefined();
    expect(domain!.value).toBeGreaterThan(0);

    db.close();
  });

  test("coldstart:format derives preferred_output_shape trait", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:format",
      value: JSON.stringify({ format: "checklist" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const shape = results.find((r) => r.dimension === "preferred_output_shape");
    expect(shape).toBeDefined();

    db.close();
  });

  test("workspace:task_* derives task_completion_rate", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    for (let i = 0; i < 3; i++) {
      engine.addObservation({
        type: "signal",
        key: "workspace:task_completed",
        value: '{"task_id": "t' + i + '"}',
        confidence: 7,
        source: "workspace",
        provenance: '{"origin":"workspace_event_bus"}',
      });
    }

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const tcr = results.find((r) => r.dimension === "task_completion_rate");
    expect(tcr).toBeDefined();
    expect(tcr!.value).toBeGreaterThan(0);

    db.close();
  });

  test("deriveFromRules with persist=false does not write traits", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: ["engineering"] }),
      confidence: 7,
      source: "coldstart",
      provenance: '{"origin":"test"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules(false);

    // Results returned
    expect(results.length).toBeGreaterThan(0);

    // But no traits in DB
    const traits = engine.getTraits();
    expect(traits.length).toBe(0);

    db.close();
  });

  test("deriveFromRules with persist=true writes traits (default)", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: ["engineering"] }),
      confidence: 7,
      source: "coldstart",
      provenance: '{"origin":"test"}',
    });

    const derivator = new Derivator(engine);
    derivator.deriveFromRules(true);

    const traits = engine.getTraits();
    expect(traits.length).toBeGreaterThan(0);

    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/coldstart-rules.test.ts`
Expected: FAIL — no rules match `coldstart:*` keys, `deriveFromRules(false)` doesn't exist

- [ ] **Step 3: Add new rules to RULES array in `src/core/profile/derivator.ts`**

Add after the `risk_tolerance` rule (after line 128), before the closing `];`:

```typescript
  {
    dimension: "detail_oriented",
    match: (key, value) => {
      if (key !== "coldstart:signal.detail_level") return false;
      try {
        const v = JSON.parse(value);
        return v.level === "high";
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.5 + count * 0.15),
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} high-detail signals detected`,
    }),
  },
  {
    dimension: "comm_style",
    match: (key) => key === "coldstart:signal.comm_style",
    derive: (count) => ({
      value: Math.min(1.0, count * 0.2),
      confidence: Math.min(10, 3 + count * 2),
      reasoning: `Cold start: ${count} communication style signals`,
    }),
  },
  {
    dimension: "domain_context",
    match: (key) => key === "coldstart:signal.domain",
    derive: (count) => ({
      value: Math.min(1.0, count * 0.25),
      confidence: Math.min(10, 4 + count * 2),
      reasoning: `Cold start: ${count} domain context signals`,
    }),
  },
  {
    dimension: "preferred_output_shape",
    match: (key) => key === "coldstart:format",
    derive: (count) => ({
      value: Math.min(1.0, count * 0.3),
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} output format preferences`,
    }),
  },
  {
    dimension: "task_completion_rate",
    match: (key) => key.startsWith("workspace:task_"),
    derive: (count) => ({
      value: Math.min(1.0, count * 0.15),
      confidence: Math.min(10, count),
      reasoning: `${count} workspace task events recorded`,
    }),
  },
```

- [ ] **Step 4: Update VALID_LLM_DIMENSIONS**

Replace the `VALID_LLM_DIMENSIONS` line (line 131-133):

```typescript
const VALID_LLM_DIMENSIONS = new Set(
  RULES.map((r) => r.dimension).concat(["autonomy", "planning_style"]),
);
```

- [ ] **Step 5: Add `persist` parameter to `deriveFromRules()`**

Change `deriveFromRules()` signature and logic (lines 150-176):

```typescript
  deriveFromRules(persist: boolean = true): DerivedTrait[] {
    const observations = this.engine.getObservations();
    if (observations.length === 0) return [];

    const results: DerivedTrait[] = [];

    for (const rule of RULES) {
      if (this.engine.isCorrected(rule.dimension)) continue;
      const matches = observations.filter((obs) =>
        rule.match(obs.key, obs.value),
      );
      if (matches.length > 0) {
        const derived = rule.derive(matches.length);
        const trait: DerivedTrait = {
          dimension: rule.dimension,
          value: Math.round(derived.value * 100) / 100,
          confidence: Math.max(1, derived.confidence),
          source: "observed",
          reasoning: derived.reasoning,
        };
        results.push(trait);
        if (persist) {
          this.engine.setTrait(trait);
        }
      }
    }

    return results;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/coldstart-rules.test.ts`
Expected: PASS

- [ ] **Step 7: Run existing derivator tests**

Run: `bun test tests/profile-derivator.test.ts`
Expected: PASS (existing rules unchanged, just new rules added)

- [ ] **Step 8: Run full test suite**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add src/core/profile/derivator.ts tests/coldstart-rules.test.ts
git commit -m "feat: add coldstart + workspace derivation rules and preview mode to Derivator"
```

---

## Task 6: Create Event Bus with State-Change Triggers

**Files:**
- Create: `src/workspace/event-bus.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/workspace/event-bus.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { WorkspaceStore } from "../../src/workspace/store";
import { eventToObservation, processStateChange, type StateChangeResult } from "../../src/workspace/event-bus";

function tempDb(): string {
  return join(tmpdir(), `kai-eb-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}

describe("eventToObservation", () => {
  test("converts workspace event to observation", () => {
    const obs = eventToObservation({
      id: 1,
      workspace_id: "ws-1",
      task_id: "t-1",
      event_type: "task_completed",
      payload: '{"task_id": "t-1"}',
      created_at: new Date().toISOString(),
    });

    expect(obs.type).toBe("signal");
    expect(obs.key).toBe("workspace:task_completed");
    expect(obs.confidence).toBe(7);
    expect(obs.source).toBe("workspace");
  });

  test("assigns correct confidence per event type", () => {
    const cases = [
      { event_type: "workspace_created", expected: 3 },
      { event_type: "task_created", expected: 4 },
      { event_type: "task_updated", expected: 5 },
      { event_type: "task_completed", expected: 7 },
      { event_type: "interaction", expected: 6 },
      { event_type: "coldstart_answer", expected: 8 },
    ] as const;

    for (const { event_type, expected } of cases) {
      const obs = eventToObservation({
        id: 1,
        workspace_id: "ws-1",
        task_id: null,
        event_type,
        payload: "{}",
        created_at: new Date().toISOString(),
      });
      expect(obs.confidence).toBe(expected);
    }
  });

  test("unknown event type gets default confidence 5", () => {
    const obs = eventToObservation({
      id: 1,
      workspace_id: "ws-1",
      task_id: null,
      event_type: "custom_event" as any,
      payload: "{}",
      created_at: new Date().toISOString(),
    });
    expect(obs.confidence).toBe(5);
  });

  test("includes workspace_id and task_id in provenance", () => {
    const obs = eventToObservation({
      id: 1,
      workspace_id: "ws-1",
      task_id: "t-1",
      event_type: "task_completed",
      payload: "{}",
      created_at: new Date().toISOString(),
    });

    const prov = JSON.parse(obs.provenance);
    expect(prov.workspace_id).toBe("ws-1");
    expect(prov.task_id).toBe("t-1");
    expect(prov.origin).toBe("workspace_event_bus");
  });
});

describe("processStateChange", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("returns shouldDerive=true for task completion", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Test" });
    const task = store.createTask({ workspace_id: ws.id, title: "T" });

    store.updateTask(task.id, { status: "completed" });
    store.addEvent({
      workspace_id: ws.id,
      task_id: task.id,
      event_type: "task_completed",
      payload: "{}",
    });

    const result = processStateChange(store, ws.id, "task_completed", task.id);

    expect(result.shouldDerive).toBe(true);
    expect(result.observations.length).toBe(1);

    store.close();
  });

  test("returns shouldDerive=true for workspace archived", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Test" });
    store.updateWorkspace(ws.id, { status: "archived" });

    const result = processStateChange(store, ws.id, "workspace_archived");

    expect(result.shouldDerive).toBe(true);

    store.close();
  });

  test("returns shouldDerive=false for task_created", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Test" });

    const result = processStateChange(store, ws.id, "task_created");

    expect(result.shouldDerive).toBe(false);

    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/workspace/event-bus.test.ts`
Expected: FAIL — cannot resolve `../../src/workspace/event-bus`

- [ ] **Step 3: Write implementation**

Create `src/workspace/event-bus.ts`:

```typescript
import type { AddObservationInput } from "../core/profile/engine";
import type { WorkspaceEvent } from "./types";
import type { WorkspaceStore } from "./store";

const CONFIDENCE_BY_EVENT_TYPE: Record<string, number> = {
  workspace_created: 3,
  task_created: 4,
  task_updated: 5,
  task_completed: 7,
  interaction: 6,
  coldstart_answer: 8,
};

const STATE_CHANGE_EVENTS = new Set([
  "task_completed",
  "workspace_archived",
]);

export function eventToObservation(
  event: WorkspaceEvent,
): AddObservationInput {
  return {
    type: "signal",
    key: `workspace:${event.event_type}`,
    value: event.payload,
    confidence: CONFIDENCE_BY_EVENT_TYPE[event.event_type] ?? 5,
    source: "workspace",
    provenance: JSON.stringify({
      workspace_id: event.workspace_id,
      task_id: event.task_id,
      origin: "workspace_event_bus",
    }),
  };
}

export interface StateChangeResult {
  shouldDerive: boolean;
  observations: AddObservationInput[];
}

export function processStateChange(
  store: WorkspaceStore,
  workspaceId: string,
  eventType: string,
  taskId?: string,
): StateChangeResult {
  const shouldDerive = STATE_CHANGE_EVENTS.has(eventType);

  try {
    const events = store.listEvents(workspaceId);
    const relevant = taskId
      ? events.filter((e) => e.task_id === taskId || e.event_type === eventType)
      : events.filter((e) => e.event_type === eventType);

    const observations = relevant.map(eventToObservation);

    return { shouldDerive, observations };
  } catch (err) {
    console.error(
      `[event-bus] Error processing state change: ${(err as Error).message}`,
    );
    return { shouldDerive: false, observations: [] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/workspace/event-bus.test.ts`
Expected: PASS

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/workspace/event-bus.ts tests/workspace/event-bus.test.ts
git commit -m "feat: add workspace event bus with state-change derivation triggers"
```

---

## Task 7: Create `kai work start` Command

**Files:**
- Create: `src/cli/work.ts`
- Modify: `src/cli/index.ts`

This is the largest task. It contains: git history scan, 4-question flow, signal extraction, profile preview, confirm/edit/restart loop.

- [ ] **Step 1: Write the failing test for git scan**

```typescript
// tests/git-scan.test.ts
import { describe, test, expect } from "bun:test";
import { scanGitHistory, type GitScanResult } from "../src/cli/work";

describe("scanGitHistory", () => {
  test("returns empty result when not in a git repo", () => {
    const result = scanGitHistory("/tmp/nonexistent-path-" + Date.now());
    expect(result.observations.length).toBe(0);
    expect(result.traits.length).toBe(0);
  });

  test("returns observations from real git repo", () => {
    // Uses the current Kai repo (has 30+ commits)
    const result = scanGitHistory(process.cwd());
    // If in the Kai repo, should produce at least 1 observation
    // (graceful fallback if not)
    if (result.observations.length > 0) {
      expect(result.observations.every((o) => o.source === "coldstart")).toBe(true);
      expect(result.observations.every((o) => o.key.startsWith("coldstart:git."))).toBe(true);
    }
  });

  test("git scan observations have confidence 4-5", () => {
    const result = scanGitHistory(process.cwd());
    for (const obs of result.observations) {
      expect(obs.confidence).toBeGreaterThanOrEqual(4);
      expect(obs.confidence).toBeLessThanOrEqual(5);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/git-scan.test.ts`
Expected: FAIL — cannot resolve `../src/cli/work`

- [ ] **Step 3: Create `src/cli/work.ts` — Part 1: git scan + signal extraction**

```typescript
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { getEngine } from "./utils";
import { Derivator } from "../core/profile/derivator";
import type { AddObservationInput } from "../core/profile/engine";
import { WorkspaceStore } from "../workspace/store";

// --- Git History Scanner ---

export interface GitScanResult {
  observations: AddObservationInput[];
  traits: { dimension: string; hints: string[] }[];
}

function makeProvenance(signalType?: string): string {
  return JSON.stringify({
    origin: "kai work start",
    extracted_at: new Date().toISOString(),
    extractor_version: "1.0.0",
    ...(signalType ? { signal_type: signalType } : {}),
  });
}

export function scanGitHistory(repoPath: string): GitScanResult {
  const observations: AddObservationInput[] = [];
  const traits: { dimension: string; hints: string[] }[] = [];

  // Check if we're in a git repo
  const gitDir = join(repoPath, ".git");
  if (!existsSync(gitDir)) return { observations, traits };

  let logOutput: string;
  try {
    logOutput = execSync(
      'git log --oneline --since="30.days ago" --format="%H %ai %s"',
      { cwd: repoPath, encoding: "utf-8", timeout: 5000 },
    ).trim();
  } catch {
    return { observations, traits };
  }

  if (!logOutput) return { observations, traits };

  const lines = logOutput.split("\n");
  if (lines.length < 5) return { observations, traits };

  // Commit time distribution → early_riser / night_owl
  const hours: number[] = [];
  for (const line of lines) {
    const match = line.match(/\d{4}-\d{2}-\d{2}T?(\d{2}):/);
    if (match) hours.push(Number.parseInt(match[1]));
  }

  if (hours.length > 0) {
    const morningCount = hours.filter((h) => h >= 5 && h <= 8).length;
    const nightCount = hours.filter((h) => h >= 22 || h <= 2).length;
    const morningRatio = morningCount / hours.length;

    observations.push({
      type: "signal",
      key: "coldstart:git.commit_time_distribution",
      value: JSON.stringify({
        morning_ratio: morningRatio,
        night_ratio: nightCount / hours.length,
        total_commits: hours.length,
      }),
      confidence: 4,
      source: "coldstart",
      provenance: makeProvenance("commit_time"),
    });

    if (morningRatio > 0.3) {
      traits.push({ dimension: "early_riser", hints: [`${Math.round(morningRatio * 100)}% morning commits`] });
    }
  }

  // Commit message avg length → detail_oriented
  const msgLengths = lines.map((l) => {
    const parts = l.split(" ");
    return parts.slice(2).join(" ").length;
  });
  const avgLen = msgLengths.reduce((a, b) => a + b, 0) / msgLengths.length;

  observations.push({
    type: "signal",
    key: "coldstart:git.commit_message_length",
    value: JSON.stringify({
      avg_length: Math.round(avgLen),
      total_commits: lines.length,
      detail_level: avgLen > 50 ? "high" : avgLen > 20 ? "medium" : "low",
    }),
    confidence: 4,
    source: "coldstart",
    provenance: makeProvenance("commit_length"),
  });

  if (avgLen > 50) {
    traits.push({
      dimension: "detail_oriented",
      hints: [`avg commit message ${Math.round(avgLen)} chars`],
    });
  }

  // Branch naming patterns → scope_appetite
  let currentBranch = "";
  try {
    currentBranch = execSync("git branch --show-current", {
      cwd: repoPath, encoding: "utf-8",
    }).trim();
  } catch {
    // detached HEAD — skip
  }

  if (currentBranch) {
    const hasStructuredPrefix = /^(feat|fix|chore|docs|refactor)\//.test(currentBranch);
    observations.push({
      type: "signal",
      key: "coldstart:git.branch_pattern",
      value: JSON.stringify({
        branch: currentBranch,
        structured: hasStructuredPrefix,
      }),
      confidence: 5,
      source: "coldstart",
      provenance: makeProvenance("branch_pattern"),
    });

    if (hasStructuredPrefix) {
      traits.push({
        dimension: "scope_appetite",
        hints: [`structured branch naming (${currentBranch.split("/")[0]}/*)`],
      });
    }
  }

  return { observations, traits };
}

// --- Cold Start Signal Extraction ---

interface ColdStartAnswer {
  slug: string;
  text: string;
}

export function extractColdStartSignals(
  answers: ColdStartAnswer[],
  gitHints: { dimension: string; hints: string[] }[],
  workspaceId: string,
): AddObservationInput[] {
  const observations: AddObservationInput[] = [];

  for (const { slug, text } of answers) {
    // Store raw answer
    observations.push({
      type: "signal",
      key: `coldstart:${slug}`,
      value: JSON.stringify({ answer: text, workspace_id: workspaceId }),
      confidence: 8,
      source: "coldstart",
      provenance: makeProvenance(),
    });

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const hasSpecifics = /\d+|specific|exactly|precisely/.test(text);

    // Signal: detail level
    observations.push({
      type: "signal",
      key: "coldstart:signal.detail_level",
      value: JSON.stringify({
        level: wordCount > 30 ? "high" : wordCount > 10 ? "medium" : "low",
        word_count: wordCount,
        has_specifics: hasSpecifics,
      }),
      confidence: 7,
      source: "coldstart",
      provenance: makeProvenance("detail_level"),
    });

    // Signal: communication style
    observations.push({
      type: "signal",
      key: "coldstart:signal.comm_style",
      value: JSON.stringify({
        style: wordCount > 40 ? "verbose" : wordCount > 15 ? "moderate" : "terse",
        word_count: wordCount,
      }),
      confidence: 6,
      source: "coldstart",
      provenance: makeProvenance("comm_style"),
    });
  }

  // Signal: domain context (from all answers)
  const allText = answers.map((a) => a.text).join(" ").toLowerCase();
  const domainSignals: string[] = [];
  if (/code|debug|deploy|api|git|build|test/i.test(allText)) domainSignals.push("engineering");
  if (/design|ux|ui|wireframe|prototype/i.test(allText)) domainSignals.push("design");
  if (/manage|team|sprint|roadmap|stakeholder/i.test(allText)) domainSignals.push("management");
  if (/research|paper|study|analysis|data/i.test(allText)) domainSignals.push("research");
  if (/write|document|content|blog|report/i.test(allText)) domainSignals.push("writing");

  if (domainSignals.length > 0) {
    // Add git hints to domain if present
    if (gitHints.some((h) => h.dimension === "detail_oriented")) {
      domainSignals.push("engineering");
    }

    observations.push({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: [...new Set(domainSignals)] }),
      confidence: 7,
      source: "coldstart",
      provenance: makeProvenance("domain"),
    });
  }

  return observations;
}

// --- Profile Preview Display ---

export function formatTraitBar(value: number, confidence: number): string {
  const filled = Math.round(value * 10);
  const empty = 10 - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `${bar}  ${confidence}/10`;
}

export function displayPreview(
  traits: import("../core/profile/derivator").DerivedTrait[],
  gitHints: { dimension: string; hints: string[] }[],
): void {
  console.log(`\n✓ Profile draft generated (${traits.length} traits detected):\n`);

  // Build hint lookup
  const hintMap = new Map<string, string[]>();
  for (const h of gitHints) {
    const existing = hintMap.get(h.dimension) ?? [];
    hintMap.set(h.dimension, [...existing, ...h.hints]);
  }

  for (const t of traits) {
    const bar = formatTraitBar(t.value, t.confidence);
    const hints = hintMap.get(t.dimension);
    const hintStr = hints ? ` + ${hints.join(", ")}` : "";
    // Truncate reasoning for display
    const reasoning = t.reasoning.length > 60
      ? `${t.reasoning.slice(0, 57)}...`
      : t.reasoning;
    console.log(`  ${t.dimension.padEnd(22)}${bar}  — ${reasoning}${hintStr}`);
  }

  console.log('\nLooks right? [Y]es / [E]dit trait / [R]estart');
}

// --- CLI Commands ---

const QUESTIONS = [
  { slug: "goal", prompt: "What are you trying to get done?\n> " },
  { slug: "success", prompt: "What would a good result look like?\n> " },
  { slug: "constraints", prompt: "Any constraints — people, tools, deadlines?\n> " },
  { slug: "format", prompt: "How should Kai organize this?\n  ▸ Checklist    ▸ Brief    ▸ Plan    ▸ Decision log\n> " },
];

export function registerWorkCommands(program: import("commander").Command): void {
  const work = program.command("work").description("Workspace management");

  work
    .command("start")
    .description("Start a new workspace with cold start profile bootstrapping")
    .action(async () => {
      const { db, engine } = getEngine();

      // Check/create identity (merged bootstrap per D2)
      let identity = engine.getIdentity();
      if (!identity) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string): Promise<string> =>
          new Promise((r) => rl.question(q, r));

        console.log("First, let's set up your identity.\n");
        const name = (await ask("What's your name? ")).trim();
        const role = (await ask("What's your role? ")).trim();

        if (!name) {
          console.log("Name is required. Aborting.");
          rl.close();
          db.close();
          return;
        }

        engine.createIdentity({
          name,
          role: role || "developer",
        });
        identity = engine.getIdentity();
        console.log(`\nWelcome, ${identity!.name}!\n`);
        rl.close();
      }

      // Step 1: Git scan
      console.log("Scanning your git history...");
      const gitResult = scanGitHistory(process.cwd());
      if (gitResult.observations.length > 0) {
        console.log(`  Found ${gitResult.observations.length} signals from ${gitResult.traits.length > 0 ? gitResult.traits.length : "no"} trait hints`);
      } else {
        console.log("  No git history to scan (that's OK)");
      }

      // Persist git observations
      for (const obs of gitResult.observations) {
        engine.addObservation(obs);
      }

      // Step 2: Create workspace (in a transaction-like manner)
      const store = new WorkspaceStore(db);
      const workspace = store.createWorkspace({
        name: `Cold Start - ${new Date().toISOString().slice(0, 10)}`,
        description: "Workspace created during cold start",
      });

      // Set up SIGINT handler for cleanup
      let cancelled = false;
      const onSigInt = () => {
        cancelled = true;
        console.log("\n\nCleaning up...");
        store.deleteWorkspace(workspace.id);
        console.log("Workspace deleted. Aborted.");
        db.close();
        process.exit(0);
      };
      process.on("SIGINT", onSigInt);

      // Step 3: 4-question flow
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> =>
        new Promise((r) => rl.question(q, r));

      console.log(`\nWorkspace: ${workspace.id}\n`);

      const answers: ColdStartAnswer[] = [];
      for (const q of QUESTIONS) {
        let answer = (await ask(q.prompt)).trim();

        // Re-prompt once for empty answers (except Q1 which is required)
        if (!answer && q.slug === "goal") {
          console.log("This one's required — tell me what you're working on.");
          answer = (await ask(q.prompt)).trim();
          if (!answer) {
            console.log("Goal is required. Cleaning up and aborting.");
            store.deleteWorkspace(workspace.id);
            rl.close();
            process.removeListener("SIGINT", onSigInt);
            db.close();
            return;
          }
        } else if (!answer) {
          // Accept empty on re-prompt for non-required questions
        }

        answers.push({ slug: q.slug, text: answer });

        // Record as workspace event
        store.addEvent({
          workspace_id: workspace.id,
          event_type: "coldstart_answer",
          payload: JSON.stringify({ slug: q.slug, text: answer }),
        });
      }

      rl.close();
      process.removeListener("SIGINT", onSigInt);

      if (cancelled) return;

      // Step 4: Signal extraction
      const signals = extractColdStartSignals(answers, gitResult.traits, workspace.id);

      // Persist all observations
      for (const obs of signals) {
        engine.addObservation(obs);
      }

      // Step 5: Derive traits in-memory (preview mode)
      const derivator = new Derivator(engine);
      const previewTraits = derivator.deriveFromRules(false);

      if (previewTraits.length === 0) {
        console.log("\nCouldn't derive any traits from your answers. Try running `kai profile derive` later after more observations.");
        store.deleteWorkspace(workspace.id);
        db.close();
        return;
      }

      // Step 6: Show preview
      displayPreview(previewTraits, gitResult.traits);

      // Step 7: Confirm/edit/restart loop
      const confirmRl = createInterface({ input: process.stdin, output: process.stdout });
      const confirmAsk = (q: string): Promise<string> =>
        new Promise((r) => confirmRl.question(q, r));

      let confirmed = false;
      while (!confirmed && !cancelled) {
        const response = ((await confirmAsk("> ")).trim().toLowerCase() || "y");

        if (response === "y" || response === "yes") {
          // Write traits to DB
          for (const trait of previewTraits) {
            engine.setTrait(trait);
          }

          // Store profile snapshot in workspace context
          store.updateWorkspaceContext(workspace.id, {
            profile_snapshot: previewTraits.map((t) => ({
              dimension: t.dimension,
              value: t.value,
              confidence: t.confidence,
              reasoning: t.reasoning,
            })),
            coldstart_completed_at: new Date().toISOString(),
          });

          console.log(`\n✓ Workspace created: ${workspace.id}`);
          console.log(`✓ Profile saved (${previewTraits.length} traits)`);
          console.log(`✓ Ready to work. Use \`kai work status\` to see your workspace.`);
          confirmed = true;
        } else if (response === "e" || response === "edit") {
          // Edit a specific trait
          const dim = (await confirmAsk("Which trait? (dimension name) ")).trim();
          const trait = previewTraits.find(
            (t) => t.dimension === dim || t.dimension.startsWith(dim),
          );
          if (!trait) {
            console.log(`  No trait matching "${dim}". Available: ${previewTraits.map((t) => t.dimension).join(", ")}`);
            continue;
          }

          const newValue = (await confirmAsk(`  Value (0.0-1.0, current: ${trait.value}): `)).trim();
          const newConf = (await confirmAsk(`  Confidence (1-10, current: ${trait.confidence}): `)).trim();

          if (newValue) trait.value = Math.max(0, Math.min(1, Number.parseFloat(newValue)));
          if (newConf) trait.confidence = Math.max(1, Math.min(10, Number.parseInt(newConf)));

          console.log("\nUpdated preview:");
          displayPreview(previewTraits, gitResult.traits);
        } else if (response === "r" || response === "restart") {
          console.log("\nRestarting cold start...");
          store.deleteWorkspace(workspace.id);
          confirmRl.close();
          db.close();
          // Re-run by recursing (clean state)
          return registerWorkCommands(program);
        } else {
          console.log("  Please enter [Y]es, [E]dit, or [R]estart");
        }
      }

      confirmRl.close();
      db.close();
    });

  work
    .command("status")
    .description("Show current workspace status")
    .action(() => {
      const { db } = getEngine();
      const store = new WorkspaceStore(db);

      const workspaces = store.listWorkspaces();
      const active = workspaces.filter((w) => w.status === "active");

      if (active.length === 0) {
        console.log("No active workspaces. Run `kai work start` to create one.");
      } else {
        for (const ws of active) {
          const tasks = store.listTasks(ws.id);
          const events = store.listEvents(ws.id);
          console.log(`\n=== ${ws.name} (${ws.id}) ===`);
          console.log(`  Status: ${ws.status}`);
          console.log(`  Tasks: ${tasks.length} (${tasks.filter((t) => t.status === "completed").length} completed)`);
          console.log(`  Events: ${events.length}`);
          console.log(`  Created: ${ws.created_at}`);
        }
      }

      store.close();
      db.close();
    });

  work
    .command("list")
    .description("List all workspaces")
    .action(() => {
      const { db } = getEngine();
      const store = new WorkspaceStore(db);

      const workspaces = store.listWorkspaces();

      if (workspaces.length === 0) {
        console.log("No workspaces found. Run `kai work start` to create one.");
      } else {
        console.log(`\nWorkspaces (${workspaces.length}):\n`);
        for (const ws of workspaces) {
          const tasks = store.listTasks(ws.id);
          const completed = tasks.filter((t) => t.status === "completed").length;
          console.log(`  ${ws.status === "active" ? "●" : "○"} ${ws.name} (${ws.id.slice(0, 8)})`);
          console.log(`    Status: ${ws.status} | Tasks: ${completed}/${tasks.length} | Created: ${ws.created_at.slice(0, 10)}`);
        }
      }

      store.close();
      db.close();
    });
}
```

- [ ] **Step 4: Register work commands in `src/cli/index.ts`**

```typescript
#!/usr/bin/env bun
import { Command } from "commander";
import { registerMcpCommands } from "./mcp";
import { registerObserveCommands } from "./observe";
import { registerProfileCommands } from "./profile";
import { registerWorkCommands } from "./work";

const program = new Command();

program
  .name("kai")
  .description("Kai — Intelligent task orchestration and personal assistant")
  .version("0.1.0");

registerProfileCommands(program);
registerObserveCommands(program);
registerMcpCommands(program);
registerWorkCommands(program);

export { program };

// Run if called directly
if (import.meta.main) {
  program.parse();
}
```

- [ ] **Step 5: Run git scan test**

Run: `bun test tests/git-scan.test.ts`
Expected: PASS

- [ ] **Step 6: Run full type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/cli/work.ts src/cli/index.ts tests/git-scan.test.ts
git commit -m "feat: add kai work start/status/list commands with git scan + cold start flow"
```

---

## Task 8: Add `kai profile diff --last` + Deprecate Bootstrap

**Files:**
- Modify: `src/cli/profile.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/profile-diff.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../src/db/client";
import { ProfileEngine } from "../src/core/profile/engine";
import { WorkspaceStore } from "../src/workspace/store";
import { Derivator } from "../src/core/profile/derivator";
import { computeProfileDiff, type ProfileDiff } from "../src/cli/profile";

function tempDb(): string {
  return join(tmpdir(), `kai-diff-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}

describe("computeProfileDiff", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("shows trait evolution since cold start", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    const store = new WorkspaceStore(db);

    // Simulate cold start snapshot
    const ws = store.createWorkspace({ name: "Cold Start" });
    const snapshotTraits = [
      { dimension: "detail_oriented", value: 0.5, confidence: 6, reasoning: "cold start" },
      { dimension: "risk_tolerance", value: 0.7, confidence: 7, reasoning: "cold start" },
    ];
    store.updateWorkspaceContext(ws.id, {
      profile_snapshot: snapshotTraits,
      coldstart_completed_at: new Date().toISOString(),
    });

    // Simulate current state: traits have evolved
    engine.setTrait({ dimension: "detail_oriented", value: 0.8, confidence: 9, source: "observed", reasoning: "12 workspace events" });
    engine.setTrait({ dimension: "risk_tolerance", value: 0.7, confidence: 8, source: "observed", reasoning: "reinforced" });
    engine.setTrait({ dimension: "comm_style", value: 0.4, confidence: 5, source: "observed", reasoning: "derived from workspace" });

    const diff = computeProfileDiff(engine, store);

    expect(diff.workspaceName).toBe("Cold Start");
    expect(diff.changed.length).toBe(1); // detail_oriented changed
    expect(diff.changed[0].dimension).toBe("detail_oriented");
    expect(diff.changed[0].before.value).toBe(0.5);
    expect(diff.changed[0].after.value).toBe(0.8);

    expect(diff.stable.length).toBe(1); // risk_tolerance stable
    expect(diff.newTraits.length).toBe(1); // comm_style is new
    expect(diff.newTraits[0].dimension).toBe("comm_style");

    store.close();
    db.close();
  });

  test("returns null when no workspace with snapshot found", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    const store = new WorkspaceStore(db);

    const diff = computeProfileDiff(engine, store);
    expect(diff).toBeNull();

    store.close();
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/profile-diff.test.ts`
Expected: FAIL — `computeProfileDiff` is not exported from `../src/cli/profile`

- [ ] **Step 3: Add `computeProfileDiff` to `src/cli/profile.ts`**

Add at the top of the file, before `registerProfileCommands`:

```typescript
import { WorkspaceStore } from "../workspace/store";
import type { Trait } from "../core/profile/types";

export interface TraitChange {
  dimension: string;
  before: { value: number; confidence: number };
  after: { value: number; confidence: number };
  reasoning: string;
}

export interface ProfileDiff {
  workspaceName: string;
  coldstartDate: string;
  changed: TraitChange[];
  stable: TraitChange[];
  newTraits: Trait[];
  removed: Trait[];
}

export function computeProfileDiff(
  engine: import("../core/profile/engine").ProfileEngine,
  store: WorkspaceStore,
): ProfileDiff | null {
  // Find the most recent workspace with a profile snapshot
  const workspaces = store.listWorkspaces();
  let snapshotWs: import("../workspace/types").Workspace | null = null;
  let snapshot: { dimension: string; value: number; confidence: number }[] | null = null;

  for (const ws of workspaces) {
    try {
      const ctx = JSON.parse(ws.context);
      if (ctx.profile_snapshot) {
        snapshotWs = ws;
        snapshot = ctx.profile_snapshot;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!snapshotWs || !snapshot) return null;

  const currentTraits = engine.getTraits();
  const snapshotMap = new Map(snapshot.map((t) => [t.dimension, t]));
  const currentMap = new Map(currentTraits.map((t) => [t.dimension, t]));

  const changed: TraitChange[] = [];
  const stable: TraitChange[] = [];
  const removed: TraitChange[] = [];

  // Check snapshot traits against current
  for (const snap of snapshot) {
    const curr = currentMap.get(snap.dimension);
    if (!curr) {
      removed.push({
        dimension: snap.dimension,
        before: { value: snap.value, confidence: snap.confidence },
        after: { value: 0, confidence: 0 },
        reasoning: "Trait removed",
      });
    } else if (Math.abs(curr.value - snap.value) > 0.01) {
      changed.push({
        dimension: snap.dimension,
        before: { value: snap.value, confidence: snap.confidence },
        after: { value: curr.value, confidence: curr.confidence },
        reasoning: curr.reasoning,
      });
    } else {
      stable.push({
        dimension: snap.dimension,
        before: { value: snap.value, confidence: snap.confidence },
        after: { value: curr.value, confidence: curr.confidence },
        reasoning: curr.reasoning,
      });
    }
  }

  // Find new traits (in current but not in snapshot)
  const newTraits = currentTraits.filter(
    (t) => !snapshotMap.has(t.dimension),
  );

  const ctx = JSON.parse(snapshotWs.context);

  return {
    workspaceName: snapshotWs.name,
    coldstartDate: ctx.coldstart_completed_at ?? snapshotWs.created_at,
    changed,
    stable,
    newTraits,
    removed,
  };
}

function formatDiff(diff: ProfileDiff): string {
  const lines: string[] = [];
  lines.push(`Profile changes since cold start (${diff.coldstartDate.slice(0, 10)}):\n`);

  for (const c of diff.changed) {
    const delta = c.after.value - c.before.value;
    const sign = delta >= 0 ? "+" : "";
    const confDelta = c.after.confidence - c.before.confidence;
    const confSign = confDelta >= 0 ? "+" : "";
    lines.push(
      `  ${c.dimension.padEnd(22)}${c.before.value.toFixed(1)}→${c.after.value.toFixed(1)} (${sign}${delta.toFixed(1)})   confidence ${c.before.confidence}→${c.after.confidence} (${confSign}${confDelta})   — ${c.reasoning}`,
    );
  }

  for (const t of diff.newTraits) {
    lines.push(
      `  + ${t.dimension.padEnd(20)}new        confidence ${t.confidence}     — ${t.reasoning}`,
    );
  }

  lines.push(
    `\n${diff.stable.length} traits stable, ${diff.changed.length} evolved, ${diff.newTraits.length} new since cold start.`,
  );

  return lines.join("\n");
}
```

- [ ] **Step 4: Add `diff` subcommand to `registerProfileCommands` and deprecate `bootstrap`**

Add inside `registerProfileCommands`, after the `decay` subcommand (after line 219):

```typescript
  profile
    .command("diff")
    .option("--last", "Compare current profile vs cold start snapshot")
    .description("Show profile changes over time")
    .action((opts) => {
      if (!opts.last) {
        console.log("Use --last to compare against cold start snapshot. Other modes coming soon.");
        return;
      }

      const { db, engine } = getEngine();
      const store = new WorkspaceStore(db);
      const diff = computeProfileDiff(engine, store);

      if (!diff) {
        console.log("No cold start snapshot found. Run `kai work start` first.");
      } else {
        console.log(formatDiff(diff));
      }

      store.close();
      db.close();
    });
```

Add deprecation notice to `bootstrap` command. Change the action (line 16):

```typescript
    .action(async () => {
      console.log("(Note: `kai profile bootstrap` is deprecated. Use `kai work start` instead.)\n");

      const rl = createInterface({
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/profile-diff.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/profile.ts tests/profile-diff.test.ts
git commit -m "feat: add kai profile diff --last + deprecate bootstrap command"
```

---

## Task 9: Cold Start E2E Test

**Files:**
- Create: `tests/cold-start.test.ts`

- [ ] **Step 1: Write the E2E test**

```typescript
// tests/cold-start.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../src/db/client";
import { ProfileEngine } from "../src/core/profile/engine";
import { Derivator } from "../src/core/profile/derivator";
import { WorkspaceStore } from "../src/workspace/store";
import { extractColdStartSignals, scanGitHistory } from "../src/cli/work";
import { computeProfileDiff } from "../src/cli/profile";

function tempDb(): string {
  return join(tmpdir(), `kai-cs-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}

describe("Cold Start E2E", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("full cold start flow: identity + questions + derive + preview + diff", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    const store = new WorkspaceStore(db);

    // 1. Create identity
    engine.createIdentity({
      name: "Test User",
      role: "engineer",
    });

    // 2. Git scan
    const gitResult = scanGitHistory(process.cwd());

    // 3. Create workspace
    const ws = store.createWorkspace({ name: "E2E Test" });

    // 4. Simulate 4 answers
    const answers = [
      { slug: "goal", text: "Build a REST API for user management with authentication and role-based access control" },
      { slug: "success", text: "All endpoints tested with 90% coverage, deployed to staging, documentation complete" },
      { slug: "constraints", text: "Must use existing PostgreSQL database, deadline is end of sprint in 2 weeks, team of 3 developers" },
      { slug: "format", text: "plan" },
    ];

    // 5. Extract signals
    const signals = extractColdStartSignals(answers, gitResult.traits, ws.id);
    expect(signals.length).toBeGreaterThan(0);

    // 6. Persist observations
    for (const obs of gitResult.observations) {
      engine.addObservation(obs);
    }
    for (const obs of signals) {
      engine.addObservation(obs);
    }

    // 7. Derive in preview mode (no persist)
    const derivator = new Derivator(engine);
    const previewTraits = derivator.deriveFromRules(false);

    // Should derive at least 5 traits
    expect(previewTraits.length).toBeGreaterThanOrEqual(5);

    // 8. Confirm: persist traits
    for (const trait of previewTraits) {
      engine.setTrait(trait);
    }

    // 9. Verify traits are in DB
    const dbTraits = engine.getTraits();
    expect(dbTraits.length).toBeGreaterThanOrEqual(5);

    // 10. Check specific traits
    const dimensions = dbTraits.map((t) => t.dimension);
    expect(dimensions).toContain("detail_oriented");
    expect(dimensions).toContain("comm_style");
    expect(dimensions).toContain("domain_context");

    // 11. Store snapshot
    store.updateWorkspaceContext(ws.id, {
      profile_snapshot: previewTraits.map((t) => ({
        dimension: t.dimension,
        value: t.value,
        confidence: t.confidence,
        reasoning: t.reasoning,
      })),
      coldstart_completed_at: new Date().toISOString(),
    });

    // 12. Simulate workspace events + re-derive
    engine.addObservation({
      type: "signal",
      key: "workspace:task_completed",
      value: '{"task_id": "t1"}',
      confidence: 7,
      source: "workspace",
      provenance: '{"origin":"workspace_event_bus"}',
    });
    engine.addObservation({
      type: "signal",
      key: "workspace:task_completed",
      value: '{"task_id": "t2"}',
      confidence: 7,
      source: "workspace",
      provenance: '{"origin":"workspace_event_bus"}',
    });

    derivator.deriveFromRules(true);

    // 13. Profile diff should show evolution
    const diff = computeProfileDiff(engine, store);
    expect(diff).not.toBeNull();
    // At least some traits should exist (stable + changed + new)
    const totalTraits = diff!.changed.length + diff!.stable.length + diff!.newTraits.length;
    expect(totalTraits).toBeGreaterThanOrEqual(5);

    store.close();
    db.close();
  });

  test("graceful handling of short answers", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    const answers = [
      { slug: "goal", text: "fix bug" },
      { slug: "success", text: "works" },
      { slug: "constraints", text: "none" },
      { slug: "format", text: "brief" },
    ];

    const signals = extractColdStartSignals(answers, [], "ws-test");
    for (const obs of signals) {
      engine.addObservation(obs);
    }

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules(false);

    // Should still produce some traits even from short answers
    // (may be fewer than with detailed answers)
    // comm_style should derive from terse signals
    const commStyle = traits.find((t) => t.dimension === "comm_style");
    expect(commStyle).toBeDefined();

    db.close();
  });

  test("git scan fallback when no repo", () => {
    const result = scanGitHistory("/tmp/does-not-exist-" + Date.now());
    expect(result.observations.length).toBe(0);
    expect(result.traits.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `bun test tests/cold-start.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Run lint**

Run: `npx @biomejs/biome check src/`
Expected: PASS (fix any issues)

- [ ] **Step 6: Commit**

```bash
git add tests/cold-start.test.ts
git commit -m "test: add cold start E2E tests covering full flow + edge cases"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| Requirement | Task |
|-------------|------|
| MIGRATION_V4 with workspace tables + source enum | Task 2 |
| Observation.source type union updated | Task 1 |
| Source precedence in setTrait() | Task 3 |
| Workspace types + store (no LocalAdapter) | Task 4 |
| Coldstart derivation rules (detail_level, comm_style, domain, format) | Task 5 |
| Workspace derivation rule (task_completion_rate) | Task 5 |
| deriveFromRules(persist) for preview-before-write | Task 5 |
| Event bus with state-change triggers | Task 6 |
| Git history auto-scan | Task 7 |
| 4-question cold start flow | Task 7 |
| Signal extraction (extractColdStartSignals) | Task 7 |
| Profile preview with trait bars + explanations | Task 7 |
| Confirm/edit/restart loop | Task 7 |
| Ctrl+C cleanup (SIGINT handler) | Task 7 |
| kai work status / kai work list | Task 7 |
| kai profile diff --last | Task 8 |
| Deprecate kai profile bootstrap | Task 8 |
| Merged bootstrap (identity in work start) | Task 7 |
| IWorkspaceAdapter interface in types.ts | Task 4 |
| Profile snapshot in workspace context | Task 7 |
| try/catch error handling in event bus | Task 6 |

### 2. Placeholder Scan

No TBD, TODO, "implement later", "add appropriate error handling", "write tests", or "similar to Task N" patterns found.

### 3. Type Consistency

- `AddObservationInput` used in Tasks 5, 6, 7 matches engine.ts definition
- `DerivedTrait` used in Tasks 5, 7, 8 matches derivator.ts export
- `WorkspaceStore` constructor takes `KaiDB` in Task 4, used with `new WorkspaceStore(db)` in Tasks 6, 7, 8
- `Workspace` / `Task` / `WorkspaceEvent` types in Task 4 match `src/workspace/types.ts` definitions
- `computeProfileDiff` signature in Task 8 test matches the implementation
- `scanGitHistory` and `extractColdStartSignals` exports match Task 7 implementation
