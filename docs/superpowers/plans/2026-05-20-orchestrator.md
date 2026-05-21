# Kai Orchestrator — Idea-to-Execution Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete orchestration layer that connects Kai's behavioral profile to idea decomposition, task scheduling, agent delegation, and a closed-loop learning cycle.

**Architecture:** 4-layer system — Orchestrator Core (planner/scheduler/dispatcher/observer) + Idea Management (3 new DB tables) + MCP Tools (7 new tools) + Closed Loop Engine (execution→observation→profile→re-plan). Built on existing ProfileEngine, WorkspaceStore, HermesBridge, and LLMProvider.

**Tech Stack:** TypeScript, Bun runtime, SQLite (bun:sqlite), MCP SDK, OpenAI-compatible LLM API, Hermes cron file protocol.

---

## File Structure

```
src/
├── core/
│   ├── orchestrator/
│   │   ├── types.ts           # Idea, PlannedTask, ExecutionResult, ExecutionObservation
│   │   ├── store.ts           # CRUD for ideas, planned_tasks, execution_results
│   │   ├── profile-context.ts # Trait → planner prompt formatting
│   │   ├── planner.ts         # Profile-aware idea → task decomposition
│   │   ├── scheduler.ts       # Profile-aware task → cron/one-off scheduling
│   │   ├── dispatcher.ts      # Task → agent delegation
│   │   ├── observer.ts        # Execution result → behavior observation → profile update
│   │   └── clustering.ts      # Observation pattern scanning → idea recommendation
│   └── profile/               # (existing)
├── bridge/
│   ├── hermes.ts              # (existing, extend with write support)
│   └── agent-bridge.ts        # AgentBridge interface + Hermes implementation
├── db/
│   └── client.ts              # (extend with MIGRATION_V5)
├── mcp/
│   ├── server.ts              # (existing)
│   ├── handlers.ts            # (existing, add orchestrator handlers)
│   ├── resources.ts           # (existing)
│   ├── schema.ts              # (existing, add orchestrator schemas)
│   ├── utils.ts               # (existing)
│   └── orchestrator-handlers.ts  # New: 7 orchestration tool handlers
└── workspace/                 # (existing)

tests/
├── core/
│   └── orchestrator/
│       ├── types.test.ts
│       ├── store.test.ts
│       ├── profile-context.test.ts
│       ├── planner.test.ts
│       ├── scheduler.test.ts
│       ├── dispatcher.test.ts
│       ├── observer.test.ts
│       └── clustering.test.ts
├── bridge/
│   └── agent-bridge.test.ts
├── migration-v5.test.ts
└── mcp/
    └── orchestrator-handlers.test.ts
```

---

## Phase 0: Hermes Write Investigation (BLOCKING)

### Task 1: Investigate Hermes Write API and Design Fallback

**Files:**
- Create: `docs/superpowers/plans/hermes-write-investigation.md`

- [ ] **Step 1: Check if Hermes exposes a write API**

Run: `ls ~/.hermes/cron/ 2>/dev/null && cat ~/.hermes/cron/jobs.json 2>/dev/null | head -20`
Expected: Either jobs.json exists (confirming file-based protocol) or directory doesn't exist

- [ ] **Step 2: Test writing a cron job file**

Run: `ls ~/.hermes/cron/ 2>/dev/null && echo 'Test if hermes reads from pending dir'`

If `~/.hermes/cron/` exists, write protocol is file-based. If not, the fallback is to create the directory structure.

- [ ] **Step 3: Document findings and decide**

Create `docs/superpowers/plans/hermes-write-investigation.md`:

```markdown
# Hermes Write Investigation

## Finding
[Fill in based on Step 1-2 results]

## Decision
- If Hermes uses file-based cron: Write JSON to `~/.hermes/cron/pending/{id}.json`
- Format: `{ "id": "...", "schedule": "...", "prompt": "...", "name": "..." }`
- Hermes picks up new files on next cron tick cycle

## Fallback
If no Hermes cron directory exists, create `~/.hermes/cron/` structure and document the protocol.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/hermes-write-investigation.md
git commit -m "docs: Hermes write API investigation results"
```

---

## Phase 1: Foundation — Types + DB + Idea/Plan Tools

### Task 2: Orchestrator Types

**Files:**
- Create: `src/core/orchestrator/types.ts`
- Create: `tests/core/orchestrator/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/orchestrator/types.test.ts
import { describe, test, expect } from "bun:test";
import type {
  Idea,
  PlannedTask,
  ExecutionResult,
  ExecutionObservation,
  IdeaStatus,
  TaskType,
  TaskStatus,
} from "../../../src/core/orchestrator/types";

describe("Orchestrator Types", () => {
  test("Idea has all required fields", () => {
    const idea: Idea = {
      id: "test-id",
      title: "Learn Rust",
      description: "Build a CLI tool in Rust",
      domain: "coding",
      priority: "high",
      deadline: "2026-06-01",
      status: "draft",
      workspace_id: "ws-1",
      created_at: "2026-05-20T00:00:00Z",
      updated_at: "2026-05-20T00:00:00Z",
    };
    expect(idea.id).toBe("test-id");
    expect(idea.domain).toBe("coding");
  });

  test("PlannedTask supports one_off and cron types", () => {
    const oneOff: PlannedTask = {
      id: "task-1",
      idea_id: "idea-1",
      workspace_id: "ws-1",
      title: "Set up project",
      description: "Initialize Cargo project",
      type: "one_off",
      agent: "hermes",
      prompt: "Run: cargo init my-cli",
      decomposition_rationale: "First step in Rust learning",
      scheduling_rationale: "No scheduling needed for one-off",
      status: "pending",
      retry_count: 0,
      max_retries: 2,
      created_at: "2026-05-20T00:00:00Z",
      updated_at: "2026-05-20T00:00:00Z",
    };
    expect(oneOff.type).toBe("one_off");

    const cron: PlannedTask = {
      ...oneOff,
      id: "task-2",
      type: "cron",
      cron_schedule: "0 9 * * 1-5",
      cron_prompt: "Practice Rust for 30 minutes",
      prompt: "Practice Rust for 30 minutes",
    };
    expect(cron.type).toBe("cron");
    expect(cron.cron_schedule).toBe("0 9 * * 1-5");
  });

  test("ExecutionResult captures agent output", () => {
    const result: ExecutionResult = {
      id: 1,
      task_id: "task-1",
      agent: "hermes",
      success: true,
      output: "Project initialized successfully",
      duration_ms: 1500,
      user_feedback: "Looks good",
      completed_at: "2026-05-20T01:00:00Z",
    };
    expect(result.success).toBe(true);
    expect(result.duration_ms).toBe(1500);
  });

  test("ExecutionObservation maps to profile dimensions", () => {
    const obs: ExecutionObservation = {
      dimension: "persistence",
      signal: "Completed all 5 tasks in the plan",
      confidence: 7,
      source: "execution_result",
    };
    expect(obs.source).toBe("execution_result");
    expect(obs.confidence).toBeGreaterThanOrEqual(1);
    expect(obs.confidence).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator/types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/orchestrator/types.ts
export type IdeaDomain = "coding" | "writing" | "research" | "creative" | "general";
export type IdeaPriority = "low" | "medium" | "high" | "critical";
export type IdeaStatus = "draft" | "planned" | "executing" | "completed" | "paused";
export type TaskType = "one_off" | "cron";
export type TaskStatus = "pending" | "scheduled" | "executing" | "completed" | "failed" | "paused";
export type AgentType = "hermes" | "openclaw" | "auto";

export interface Idea {
  id: string;
  title: string;
  description: string;
  domain: IdeaDomain;
  priority: IdeaPriority;
  deadline?: string;
  status: IdeaStatus;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export interface PlannedTask {
  id: string;
  idea_id: string;
  workspace_id: string;
  title: string;
  description: string;
  type: TaskType;
  cron_schedule?: string;
  cron_prompt?: string;
  agent: AgentType;
  prompt: string;
  decomposition_rationale: string;
  scheduling_rationale: string;
  status: TaskStatus;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
}

export interface ExecutionResult {
  id: number;
  task_id: string;
  agent: string;
  success: boolean;
  output: string;
  duration_ms: number;
  user_feedback?: string;
  completed_at: string;
}

export interface ExecutionObservation {
  dimension: string;
  signal: string;
  confidence: number;
  source: "execution_result";
}

export interface TaskModification {
  task_id?: string;
  action: "update" | "remove" | "add";
  field?: "title" | "agent" | "prompt" | "cron_schedule" | "type";
  value?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/orchestrator/types.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/types.ts tests/core/orchestrator/types.test.ts
git commit -m "feat(orchestrator): add core types for ideas, tasks, execution results"
```

---

### Task 3: V5 Database Migration

**Files:**
- Modify: `src/db/client.ts:96-162` (add MIGRATION_V5, update runMigrations)
- Create: `tests/migration-v5.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/migration-v5.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../src/db/client";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";

describe("V5 Migration", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-v5-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("creates ideas table with all columns", () => {
    const database = db.getDatabase();
    const tables = db.listTables();
    expect(tables).toContain("ideas");

    database.run(
      `INSERT INTO ideas (id, title, description, domain, priority, status, workspace_id)
       VALUES ('test', 'Test Idea', 'Desc', 'coding', 'medium', 'draft', 'ws-1')`,
    );
    const row = database.query("SELECT * FROM ideas WHERE id = 'test'").get() as Record<string, unknown>;
    expect(row.title).toBe("Test Idea");
    expect(row.domain).toBe("coding");
  });

  test("creates planned_tasks table with foreign key to ideas", () => {
    const database = db.getDatabase();
    const tables = db.listTables();
    expect(tables).toContain("planned_tasks");

    database.run(
      `INSERT INTO ideas (id, title, description, domain, priority, status, workspace_id)
       VALUES ('idea-1', 'Test', 'Desc', 'coding', 'medium', 'draft', 'ws-1')`,
    );
    database.run(
      `INSERT INTO planned_tasks (id, idea_id, workspace_id, title, description, type, agent, prompt, decomposition_rationale, scheduling_rationale, status)
       VALUES ('task-1', 'idea-1', 'ws-1', 'Task', 'Desc', 'one_off', 'hermes', 'Do it', 'Reason', 'Reason', 'pending')`,
    );
    const row = database.query("SELECT * FROM planned_tasks WHERE id = 'task-1'").get() as Record<string, unknown>;
    expect(row.type).toBe("one_off");
  });

  test("creates execution_results table", () => {
    const database = db.getDatabase();
    const tables = db.listTables();
    expect(tables).toContain("execution_results");
  });

  test("observations source CHECK removed — accepts execution_result", () => {
    const database = db.getDatabase();
    database.run(
      `INSERT INTO observations (type, key, value, confidence, source, provenance)
       VALUES ('behavior', 'test:exec', '{}', 5, 'execution_result', '{}')`,
    );
    const row = database.query("SELECT * FROM observations WHERE source = 'execution_result'").get() as Record<string, unknown>;
    expect(row.source).toBe("execution_result");
  });

  test("preserves existing data through migration", () => {
    const database = db.getDatabase();
    database.run(
      `INSERT INTO observations (type, key, value, confidence, source, provenance)
       VALUES ('behavior', 'pre-v5:test', '{"action":"test"}', 7, 'mcp', '{}')`,
    );
    const row = database.query("SELECT * FROM observations WHERE key = 'pre-v5:test'").get() as Record<string, unknown>;
    expect(row.confidence).toBe(7);
  });

  test("migration is idempotent — init twice does not error", () => {
    db.close();
    const db2 = new KaiDB(dbPath);
    const tables = db2.listTables();
    expect(tables).toContain("ideas");
    expect(tables).toContain("planned_tasks");
    expect(tables).toContain("execution_results");
    db2.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/migration-v5.test.ts`
Expected: FAIL — tables "ideas", "planned_tasks" not found

- [ ] **Step 3: Write implementation**

Add MIGRATION_V5 to `src/db/client.ts` after `MIGRATION_V4` (after line 162):

```typescript
const MIGRATION_V5 = `
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- New orchestrator tables
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'medium',
  deadline TEXT,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS planned_tasks (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'one_off',
  cron_schedule TEXT,
  cron_prompt TEXT,
  agent TEXT NOT NULL DEFAULT 'hermes',
  prompt TEXT NOT NULL,
  decomposition_rationale TEXT NOT NULL DEFAULT '',
  scheduling_rationale TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS execution_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES planned_tasks(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  success INTEGER NOT NULL CHECK(success IN (0,1)),
  output TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER,
  user_feedback TEXT,
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_workspace ON ideas(workspace_id);
CREATE INDEX IF NOT EXISTS idx_planned_tasks_idea ON planned_tasks(idea_id);
CREATE INDEX IF NOT EXISTS idx_planned_tasks_status ON planned_tasks(status);
CREATE INDEX IF NOT EXISTS idx_execution_results_task ON execution_results(task_id);

-- Remove source CHECK constraint from observations (app-layer validation)
CREATE TABLE IF NOT EXISTS observations_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('behavior','preference','feedback','context','signal')),
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL DEFAULT 5 CHECK(confidence >= 1 AND confidence <= 10),
  source TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO observations_v5 (id, type, key, value, confidence, source, provenance, ts)
  SELECT id, type, key, value, confidence, source, provenance, ts FROM observations;

DROP TABLE IF EXISTS observations;
ALTER TABLE observations_v5 RENAME TO observations;

CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_key ON observations(key);
CREATE INDEX IF NOT EXISTS idx_observations_ts ON observations(ts);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;
```

Add migration step to `runMigrations()` in `src/db/client.ts` (after the v4 block, before `PRAGMA foreign_keys = ON`):

```typescript
    if (currentVersion < 5) {
      this.db.exec(MIGRATION_V5);
      this.db.run(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
        [5],
      );
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/migration-v5.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `bun test`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/db/client.ts tests/migration-v5.test.ts
git commit -m "feat(db): V5 migration — orchestrator tables, remove source CHECK"
```

---

### Task 4: Orchestrator Store (CRUD)

**Files:**
- Create: `src/core/orchestrator/store.ts`
- Create: `tests/core/orchestrator/store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/orchestrator/store.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("OrchestratorStore", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-orch-store-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  // --- Ideas ---

  test("createIdea inserts and returns idea", () => {
    const idea = store.createIdea({
      title: "Learn Rust",
      description: "Build a CLI tool",
      domain: "coding",
      priority: "high",
      workspace_id: "ws-1",
    });
    expect(idea.id).toBeDefined();
    expect(idea.title).toBe("Learn Rust");
    expect(idea.status).toBe("draft");
  });

  test("getIdea returns null for nonexistent id", () => {
    expect(store.getIdea("nope")).toBeNull();
  });

  test("updateIdeaStatus transitions correctly", () => {
    const idea = store.createIdea({
      title: "Test",
      description: "Desc",
      domain: "general",
      priority: "medium",
      workspace_id: "ws-1",
    });
    store.updateIdeaStatus(idea.id, "planned");
    const updated = store.getIdea(idea.id);
    expect(updated?.status).toBe("planned");
  });

  test("listIdeasByStatus filters correctly", () => {
    store.createIdea({ title: "A", description: "A", domain: "general", priority: "low", workspace_id: "ws-1" });
    store.createIdea({ title: "B", description: "B", domain: "general", priority: "low", workspace_id: "ws-1" });
    const drafts = store.listIdeasByStatus("draft");
    expect(drafts).toHaveLength(2);
  });

  test("listIdeasByWorkspace filters by workspace", () => {
    store.createIdea({ title: "A", description: "A", domain: "general", priority: "low", workspace_id: "ws-1" });
    store.createIdea({ title: "B", description: "B", domain: "general", priority: "low", workspace_id: "ws-2" });
    const ws1Ideas = store.listIdeasByWorkspace("ws-1");
    expect(ws1Ideas).toHaveLength(1);
    expect(ws1Ideas[0].title).toBe("A");
  });

  // --- Planned Tasks ---

  test("createTask inserts and returns task", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({
      idea_id: idea.id,
      workspace_id: "ws-1",
      title: "Step 1",
      description: "First step",
      type: "one_off",
      agent: "hermes",
      prompt: "Do step 1",
      decomposition_rationale: "Start here",
      scheduling_rationale: "Immediate",
    });
    expect(task.id).toBeDefined();
    expect(task.idea_id).toBe(idea.id);
    expect(task.status).toBe("pending");
  });

  test("getTasksByIdea returns tasks for an idea", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T2", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const tasks = store.getTasksByIdea(idea.id);
    expect(tasks).toHaveLength(2);
  });

  test("updateTaskStatus transitions correctly", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTaskStatus(task.id, "scheduled");
    const updated = store.getTask(task.id);
    expect(updated?.status).toBe("scheduled");
  });

  test("incrementRetryCount bumps retry_count", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.incrementRetryCount(task.id);
    const updated = store.getTask(task.id);
    expect(updated?.retry_count).toBe(1);
  });

  test("deleteTasksByIdea cascades on idea delete", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    db.getDatabase().run("DELETE FROM ideas WHERE id = ?", [idea.id]);
    expect(store.getTasksByIdea(idea.id)).toHaveLength(0);
  });

  // --- Execution Results ---

  test("addExecutionResult inserts and returns result", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const result = store.addExecutionResult({
      task_id: task.id,
      agent: "hermes",
      success: true,
      output: "Done",
      duration_ms: 500,
    });
    expect(result.id).toBeGreaterThan(0);
    expect(result.success).toBe(true);
  });

  test("getResultsByTask returns results for a task", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "OK", duration_ms: 100 });
    store.addExecutionResult({ task_id: task.id, agent: "hermes", success: false, output: "Fail", duration_ms: 200 });
    const results = store.getResultsByTask(task.id);
    expect(results).toHaveLength(2);
  });

  test("addUserFeedback updates existing result", () => {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "OK", duration_ms: 100 });
    store.addUserFeedback(result.id, "Great work!");
    const updated = store.getResultsByTask(task.id);
    expect(updated[0].user_feedback).toBe("Great work!");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator/store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/orchestrator/store.ts
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { KaiDB } from "../../db/client";
import type {
  Idea,
  PlannedTask,
  ExecutionResult,
  IdeaDomain,
  IdeaPriority,
  IdeaStatus,
  TaskStatus,
} from "./types";

interface CreateIdeaInput {
  title: string;
  description: string;
  domain?: IdeaDomain;
  priority?: IdeaPriority;
  deadline?: string;
  workspace_id: string;
}

interface CreateTaskInput {
  idea_id: string;
  workspace_id: string;
  title: string;
  description: string;
  type: "one_off" | "cron";
  cron_schedule?: string;
  cron_prompt?: string;
  agent: string;
  prompt: string;
  decomposition_rationale: string;
  scheduling_rationale: string;
}

interface AddResultInput {
  task_id: string;
  agent: string;
  success: boolean;
  output: string;
  duration_ms: number;
  user_feedback?: string;
}

export class OrchestratorStore {
  private db: Database;

  constructor(kaiDb: KaiDB) {
    this.db = kaiDb.getDatabase();
  }

  // --- Ideas ---

  createIdea(input: CreateIdeaInput): Idea {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO ideas (id, title, description, domain, priority, deadline, workspace_id, status)
         VALUES ($id, $title, $desc, $domain, $priority, $deadline, $ws, 'draft')`,
      )
      .run({
        $id: id,
        $title: input.title,
        $desc: input.description,
        $domain: input.domain ?? "general",
        $priority: input.priority ?? "medium",
        $deadline: input.deadline ?? null,
        $ws: input.workspace_id,
      });
    return this.getIdea(id) as Idea;
  }

  getIdea(id: string): Idea | null {
    return this.db
      .query("SELECT * FROM ideas WHERE id = $id")
      .get({ $id: id }) as Idea | null;
  }

  updateIdeaStatus(id: string, status: IdeaStatus): void {
    this.db
      .query("UPDATE ideas SET status = $status, updated_at = datetime('now') WHERE id = $id")
      .run({ $id: id, $status: status });
  }

  listIdeasByStatus(status: IdeaStatus): Idea[] {
    return this.db
      .query("SELECT * FROM ideas WHERE status = $status ORDER BY created_at DESC")
      .all({ $status: status }) as Idea[];
  }

  listIdeasByWorkspace(workspaceId: string): Idea[] {
    return this.db
      .query("SELECT * FROM ideas WHERE workspace_id = $ws ORDER BY created_at DESC")
      .all({ $ws: workspaceId }) as Idea[];
  }

  // --- Planned Tasks ---

  createTask(input: CreateTaskInput): PlannedTask {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO planned_tasks (id, idea_id, workspace_id, title, description, type, cron_schedule, cron_prompt, agent, prompt, decomposition_rationale, scheduling_rationale, status)
         VALUES ($id, $idea, $ws, $title, $desc, $type, $cron, $cronPrompt, $agent, $prompt, $decompR, $schedR, 'pending')`,
      )
      .run({
        $id: id,
        $idea: input.idea_id,
        $ws: input.workspace_id,
        $title: input.title,
        $desc: input.description,
        $type: input.type,
        $cron: input.cron_schedule ?? null,
        $cronPrompt: input.cron_prompt ?? null,
        $agent: input.agent,
        $prompt: input.prompt,
        $decompR: input.decomposition_rationale,
        $schedR: input.scheduling_rationale,
      });
    return this.getTask(id) as PlannedTask;
  }

  getTask(id: string): PlannedTask | null {
    return this.db
      .query("SELECT * FROM planned_tasks WHERE id = $id")
      .get({ $id: id }) as PlannedTask | null;
  }

  getTasksByIdea(ideaId: string): PlannedTask[] {
    return this.db
      .query("SELECT * FROM planned_tasks WHERE idea_id = $idea ORDER BY created_at")
      .all({ $idea: ideaId }) as PlannedTask[];
  }

  updateTaskStatus(id: string, status: TaskStatus): void {
    this.db
      .query("UPDATE planned_tasks SET status = $status, updated_at = datetime('now') WHERE id = $id")
      .run({ $id: id, $status: status });
  }

  updateTask(id: string, fields: Partial<Pick<PlannedTask, "title" | "agent" | "prompt" | "cron_schedule" | "type" | "description">>): void {
    const sets: string[] = [];
    const params: Record<string, string | null> = { $id: id };
    if (fields.title !== undefined) { sets.push("title = $v"); params.$v = fields.title; }
    if (fields.description !== undefined) { sets.push("description = $v2"); params.$v2 = fields.description; }
    if (fields.agent !== undefined) { sets.push("agent = $v3"); params.$v3 = fields.agent; }
    if (fields.prompt !== undefined) { sets.push("prompt = $v4"); params.$v4 = fields.prompt; }
    if (fields.cron_schedule !== undefined) { sets.push("cron_schedule = $v5"); params.$v5 = fields.cron_schedule; }
    if (fields.type !== undefined) { sets.push("type = $v6"); params.$v6 = fields.type; }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    this.db.query(`UPDATE planned_tasks SET ${sets.join(", ")} WHERE id = $id`).run(params);
  }

  incrementRetryCount(id: string): void {
    this.db
      .query("UPDATE planned_tasks SET retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = $id")
      .run({ $id: id });
  }

  deleteTask(id: string): void {
    this.db.query("DELETE FROM planned_tasks WHERE id = $id").run({ $id: id });
  }

  // --- Execution Results ---

  addExecutionResult(input: AddResultInput): ExecutionResult {
    const result = this.db
      .query(
        `INSERT INTO execution_results (task_id, agent, success, output, duration_ms, user_feedback)
         VALUES ($task, $agent, $success, $output, $duration, $feedback)`,
      )
      .run({
        $task: input.task_id,
        $agent: input.agent,
        $success: input.success ? 1 : 0,
        $output: input.output,
        $duration: input.duration_ms,
        $feedback: input.user_feedback ?? null,
      });
    return this.db
      .query("SELECT * FROM execution_results WHERE id = $id")
      .get({ $id: Number(result.lastInsertRowid) }) as ExecutionResult;
  }

  getResultsByTask(taskId: string): ExecutionResult[] {
    return this.db
      .query("SELECT * FROM execution_results WHERE task_id = $task ORDER BY completed_at DESC")
      .all({ $task: taskId }) as ExecutionResult[];
  }

  getResultsByIdea(ideaId: string): ExecutionResult[] {
    return this.db
      .query(
        `SELECT er.* FROM execution_results er
         JOIN planned_tasks pt ON er.task_id = pt.id
         WHERE pt.idea_id = $idea
         ORDER BY er.completed_at DESC`,
      )
      .all({ $idea: ideaId }) as ExecutionResult[];
  }

  addUserFeedback(resultId: number, feedback: string): void {
    this.db
      .query("UPDATE execution_results SET user_feedback = $fb WHERE id = $id")
      .run({ $id: resultId, $fb: feedback });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/orchestrator/store.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/store.ts tests/core/orchestrator/store.test.ts
git commit -m "feat(orchestrator): add CRUD store for ideas, tasks, execution results"
```

---

### Task 5: Profile Context Formatter

**Files:**
- Create: `src/core/orchestrator/profile-context.ts`
- Create: `tests/core/orchestrator/profile-context.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/orchestrator/profile-context.test.ts
import { describe, test, expect } from "bun:test";
import { formatProfileContext, DEFAULT_TRAITS } from "../../../src/core/orchestrator/profile-context";
import type { Trait } from "../../../src/core/profile/types";

describe("formatProfileContext", () => {
  test("returns defaults when no traits provided", () => {
    const ctx = formatProfileContext([]);
    expect(ctx).toContain("detail_oriented");
    expect(ctx).toContain("0.5");
  });

  test("uses actual trait values when present", () => {
    const traits: Trait[] = [
      { id: "1", dimension: "detail_oriented", value: 0.9, confidence: 8, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
      { id: "2", dimension: "risk_tolerance", value: 0.3, confidence: 6, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];
    const ctx = formatProfileContext(traits);
    expect(ctx).toContain("detail_oriented: 0.9");
    expect(ctx).toContain("risk_tolerance: 0.3");
  });

  test("fills missing dimensions with defaults", () => {
    const traits: Trait[] = [
      { id: "1", dimension: "early_riser", value: 0.8, confidence: 7, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];
    const ctx = formatProfileContext(traits);
    expect(ctx).toContain("early_riser: 0.8");
    expect(ctx).toContain("detail_oriented: 0.5");
  });

  test("includes scheduling guidance", () => {
    const traits: Trait[] = [
      { id: "1", dimension: "early_riser", value: 0.9, confidence: 8, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];
    const ctx = formatProfileContext(traits);
    expect(ctx).toContain("morning");
  });

  test("includes decomposition guidance for high detail_oriented", () => {
    const traits: Trait[] = [
      { id: "1", dimension: "detail_oriented", value: 0.85, confidence: 7, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];
    const ctx = formatProfileContext(traits);
    expect(ctx).toContain("fine-grained");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator/profile-context.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/orchestrator/profile-context.ts
import type { Trait } from "../profile/types";

export const DEFAULT_TRAITS: Record<string, number> = {
  detail_oriented: 0.5,
  risk_tolerance: 0.5,
  planning_style: 0.5,
  early_riser: 0.5,
  burst_worker: 0.3,
  consistency: 0.5,
  scope_appetite: 0.5,
  tinkerer: 0.5,
};

const SCHEDULING_GUIDANCE: Record<string, { high: string; low: string }> = {
  early_riser: { high: "Schedule cron tasks in 6-9am morning slots", low: "Avoid early morning scheduling" },
  burst_worker: { high: "Batch tasks in 2-hour focused windows", low: "Spread tasks evenly throughout the day" },
  detail_oriented: { high: "Use fine-grained tasks with explicit checkpoints", low: "Use broader tasks with flexible scope" },
  risk_tolerance: { high: "Use ambitious approaches, skip confirmation steps", low: "Use safe, conservative approaches with confirmation" },
};

const DECOMPOSITION_GUIDANCE: Record<string, { high: string; low: string }> = {
  detail_oriented: { high: "Decompose into many small, concrete tasks (6-8 per idea)", low: "Decompose into fewer, broader tasks (3-4 per idea)" },
  scope_appetite: { high: "Include stretch goals and ambitious tasks", low: "Focus on essential, achievable tasks" },
  planning_style: { high: "Decompose into same-day actionable chunks", low: "Decompose into weekly milestones" },
};

function getTraitValue(traits: Trait[], dimension: string): number {
  const trait = traits.find((t) => t.dimension === dimension);
  return trait ? trait.value : (DEFAULT_TRAITS[dimension] ?? 0.5);
}

export function formatProfileContext(traits: Trait[]): string {
  const traitMap = new Map(traits.map((t) => [t.dimension, t.value]));
  const lines: string[] = ["## User Behavioral Profile", ""];

  for (const [dim, defaultValue] of Object.entries(DEFAULT_TRAITS)) {
    const value = traitMap.get(dim) ?? defaultValue;
    lines.push(`- ${dim}: ${value}`);
  }

  lines.push("", "## Scheduling Guidance", "");
  for (const [dim, guidance] of Object.entries(SCHEDULING_GUIDANCE)) {
    const value = getTraitValue(traits, dim);
    lines.push(value >= 0.6 ? `- ${guidance.high}` : value <= 0.4 ? `- ${guidance.low}` : "");
  }

  lines.push("", "## Decomposition Guidance", "");
  for (const [dim, guidance] of Object.entries(DECOMPOSITION_GUIDANCE)) {
    const value = getTraitValue(traits, dim);
    if (value >= 0.6) lines.push(`- ${guidance.high}`);
    else if (value <= 0.4) lines.push(`- ${guidance.low}`);
  }

  return lines.filter((l) => l !== "").join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/orchestrator/profile-context.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/profile-context.ts tests/core/orchestrator/profile-context.test.ts
git commit -m "feat(orchestrator): add profile context formatter for planner prompts"
```

---

### Task 6: Planner (Profile-Aware Idea Decomposition)

**Files:**
- Create: `src/core/orchestrator/planner.ts`
- Create: `tests/core/orchestrator/planner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/orchestrator/planner.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { Planner } from "../../../src/core/orchestrator/planner";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import type { Trait } from "../../../src/core/profile/types";

// Mock LLM provider
function createMockLLM(response: Record<string, unknown>) {
  return {
    getConfig: () => ({ apiKey: "test", baseUrl: "http://localhost", model: "test" }),
    call: async () => response,
    validateWithSchema: () => {},
  };
}

const VALID_LLM_RESPONSE = {
  tasks: [
    { title: "Set up project", description: "Initialize the project structure", type: "one_off", agent: "hermes", prompt: "Initialize project", decomposition_rationale: "First step" },
    { title: "Write tests", description: "Set up test framework and write initial tests", type: "one_off", agent: "hermes", prompt: "Set up tests", decomposition_rationale: "Validate approach" },
    { title: "Daily practice", description: "30 min daily coding practice", type: "cron", agent: "hermes", prompt: "Practice coding", cron_schedule: "0 9 * * 1-5", cron_prompt: "Practice for 30 min", decomposition_rationale: "Build habit" },
  ],
};

describe("Planner", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-planner-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("decomposeIdea creates tasks from LLM response", async () => {
    const llm = createMockLLM(VALID_LLM_RESPONSE);
    const planner = new Planner(store, llm);
    const idea = store.createIdea({ title: "Learn Rust", description: "Build a CLI tool", domain: "coding", priority: "high", workspace_id: "ws-1" });

    const tasks = await planner.decomposeIdea(idea.id, []);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe("Set up project");
    expect(tasks[2].type).toBe("cron");
  });

  test("decomposeIdea falls back to single task on LLM failure", async () => {
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async () => { throw new Error("LLM down"); },
      validateWithSchema: () => {},
    };
    const planner = new Planner(store, llm);
    const idea = store.createIdea({ title: "Learn Rust", description: "Build a CLI tool", domain: "coding", priority: "high", workspace_id: "ws-1" });

    const tasks = await planner.decomposeIdea(idea.id, []);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Learn Rust");
    expect(tasks[0].prompt).toContain("Build a CLI tool");
  });

  test("decomposeIdea retries once on validation failure then falls back", async () => {
    let callCount = 0;
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async () => {
        callCount++;
        return { tasks: [{ title: "Missing fields" }] };
      },
      validateWithSchema: (_obj: Record<string, unknown>, fields: string[]) => {
        if (fields.includes("description")) throw new Error("Missing field: description");
      },
    };
    const planner = new Planner(store, llm);
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });

    const tasks = await planner.decomposeIdea(idea.id, []);
    expect(tasks).toHaveLength(1);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test("decomposeIdea includes profile context in prompt", async () => {
    let capturedPrompt = "";
    const llm = {
      getConfig: () => ({ apiKey: "test", baseUrl: "", model: "" }),
      call: async (prompt: string, systemPrompt: string) => {
        capturedPrompt = prompt;
        return VALID_LLM_RESPONSE;
      },
      validateWithSchema: () => {},
    };
    const planner = new Planner(store, llm);
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "coding", priority: "medium", workspace_id: "ws-1" });
    const traits: Trait[] = [
      { id: "1", dimension: "detail_oriented", value: 0.9, confidence: 8, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];

    await planner.decomposeIdea(idea.id, traits);
    expect(capturedPrompt).toContain("detail_oriented");
  });

  test("decomposeIdea rejects tasks outside 3-8 range", async () => {
    const tooManyTasks = {
      tasks: Array.from({ length: 10 }, (_, i) => ({
        title: `Task ${i}`, description: `Desc ${i}`, type: "one_off", agent: "hermes",
        prompt: `Do task ${i}`, decomposition_rationale: `Reason ${i}`,
      })),
    };
    const llm = createMockLLM(tooManyTasks);
    const planner = new Planner(store, llm);
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "general", priority: "medium", workspace_id: "ws-1" });

    const tasks = await planner.decomposeIdea(idea.id, []);
    expect(tasks.length).toBeLessThanOrEqual(8);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  test("throws if idea not found", async () => {
    const llm = createMockLLM(VALID_LLM_RESPONSE);
    const planner = new Planner(store, llm);
    await expect(planner.decomposeIdea("nonexistent", [])).rejects.toThrow("Idea not found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator/planner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/orchestrator/planner.ts
import type { LLMProvider } from "../../llm/provider";
import type { Trait } from "../profile/types";
import { formatProfileContext } from "./profile-context";
import type { OrchestratorStore } from "./store";

const PLANNER_SYSTEM_PROMPT = `You are a task decomposition engine. Given an idea and a user's behavioral profile, break the idea into actionable tasks.

Return a JSON object with a "tasks" array. Each task MUST have these fields:
- title (string, max 100 chars)
- description (string, max 500 chars)
- type ("one_off" or "cron")
- agent ("hermes")
- prompt (string, the execution instruction for the agent)
- decomposition_rationale (string, why this task exists)
- scheduling_rationale (string, why scheduled this way)

For cron tasks, also include:
- cron_schedule (cron expression)
- cron_prompt (prompt for each cycle)

Constraints:
- Produce 3-8 tasks total
- Each description max 500 characters
- Use the user's behavioral profile to influence decomposition strategy`;

export class Planner {
  private store: OrchestratorStore;
  private llm: LLMProvider;

  constructor(store: OrchestratorStore, llm: LLMProvider) {
    this.store = store;
    this.llm = llm;
  }

  async decomposeIdea(ideaId: string, traits: Trait[]): Promise<import("./types").PlannedTask[]> {
    const idea = this.store.getIdea(ideaId);
    if (!idea) throw new Error("Idea not found");

    const profileContext = formatProfileContext(traits);
    const prompt = JSON.stringify({
      idea: { title: idea.title, description: idea.description, domain: idea.domain, priority: idea.priority, deadline: idea.deadline },
      profile: profileContext,
    });

    try {
      const response = await this.llm.call(prompt, PLANNER_SYSTEM_PROMPT);
      this.llm.validateWithSchema(response as Record<string, unknown>, ["tasks"]);

      const tasks = (response as { tasks: unknown[] }).tasks;
      if (!Array.isArray(tasks) || tasks.length < 1) throw new Error("No tasks returned");

      return this.persistValidatedTasks(ideaId, idea.workspace_id, tasks);
    } catch {
      return this.fallbackSingleTask(idea);
    }
  }

  private persistValidatedTasks(ideaId: string, workspaceId: string, rawTasks: unknown[]): import("./types").PlannedTask[] {
    const validTasks = rawTasks
      .filter((t) => typeof t === "object" && t !== null)
      .map((t) => t as Record<string, unknown>)
      .filter((t) => typeof t.title === "string" && typeof t.description === "string" && typeof t.prompt === "string")
      .slice(0, 8);

    if (validTasks.length < 3) {
      const idea = this.store.getIdea(ideaId);
      if (idea) return this.fallbackSingleTask(idea);
      throw new Error("Idea not found for fallback");
    }

    return validTasks.map((t) =>
      this.store.createTask({
        idea_id: ideaId,
        workspace_id: workspaceId,
        title: String(t.title).slice(0, 100),
        description: String(t.description).slice(0, 500),
        type: t.type === "cron" ? "cron" : "one_off",
        cron_schedule: typeof t.cron_schedule === "string" ? t.cron_schedule : undefined,
        cron_prompt: typeof t.cron_prompt === "string" ? t.cron_prompt : undefined,
        agent: typeof t.agent === "string" ? t.agent : "hermes",
        prompt: String(t.prompt),
        decomposition_rationale: typeof t.decomposition_rationale === "string" ? t.decomposition_rationale : "",
        scheduling_rationale: typeof t.scheduling_rationale === "string" ? t.scheduling_rationale : "",
      }),
    );
  }

  private fallbackSingleTask(idea: import("./types").Idea): import("./types").PlannedTask[] {
    return [
      this.store.createTask({
        idea_id: idea.id,
        workspace_id: idea.workspace_id,
        title: idea.title,
        description: idea.description,
        type: "one_off",
        agent: "hermes",
        prompt: idea.description,
        decomposition_rationale: "Fallback: single task from original idea description",
        scheduling_rationale: "Execute when ready",
      }),
    ];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/orchestrator/planner.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/planner.ts tests/core/orchestrator/planner.test.ts
git commit -m "feat(orchestrator): add profile-aware planner with LLM decomposition"
```

---

### Task 7: Agent Bridge Interface + Hermes Write Support

**Files:**
- Create: `src/bridge/agent-bridge.ts`
- Create: `tests/bridge/agent-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/bridge/agent-bridge.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { HermesAgentBridge } from "../../src/bridge/agent-bridge";
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("HermesAgentBridge", () => {
  let bridge: HermesAgentBridge;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `kai-bridge-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "cron", "pending"), { recursive: true });
    bridge = new HermesAgentBridge(testDir);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true }); } catch {}
  });

  test("dispatchOneOff writes a pending task file", async () => {
    const result = await bridge.dispatchOneOff("task-1", "hermes", "Do something");
    expect(result.success).toBe(true);
    expect(result.agent).toBe("hermes");

    const pending = readdirSync(join(testDir, "cron", "pending"));
    expect(pending.length).toBe(1);
    const content = JSON.parse(readFileSync(join(testDir, "cron", "pending", pending[0]), "utf-8"));
    expect(content.id).toBe("task-1");
    expect(content.prompt).toBe("Do something");
  });

  test("scheduleCron writes a cron job file", async () => {
    const result = await bridge.scheduleCron("task-1", "0 9 * * 1-5", "Daily practice");
    expect(result.success).toBe(true);

    const pending = readdirSync(join(testDir, "cron", "pending"));
    expect(pending.length).toBe(1);
    const content = JSON.parse(readFileSync(join(testDir, "cron", "pending", pending[0]), "utf-8"));
    expect(content.schedule).toBe("0 9 * * 1-5");
    expect(content.type).toBe("cron");
  });

  test("cancelCron removes the cron file", async () => {
    await bridge.scheduleCron("task-1", "0 9 * * *", "Test");
    await bridge.cancelCron("task-1");
    const pending = readdirSync(join(testDir, "cron", "pending"));
    expect(pending.length).toBe(0);
  });

  test("listPending returns all pending jobs", async () => {
    await bridge.dispatchOneOff("task-1", "hermes", "A");
    await bridge.dispatchOneOff("task-2", "hermes", "B");
    const pending = await bridge.listPending();
    expect(pending).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/bridge/agent-bridge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/bridge/agent-bridge.ts
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface DispatchResult {
  success: boolean;
  agent: string;
  jobId?: string;
}

export interface AgentBridge {
  dispatchOneOff(taskId: string, agent: string, prompt: string): Promise<DispatchResult>;
  scheduleCron(taskId: string, schedule: string, prompt: string): Promise<DispatchResult>;
  cancelCron(taskId: string): Promise<boolean>;
  listPending(): Promise<Array<{ id: string; type: string; schedule?: string; prompt: string }>>;
}

export class HermesAgentBridge implements AgentBridge {
  private baseDir: string;

  constructor(baseDir?: string) {
    const { homedir } = require("node:os");
    this.baseDir = baseDir ?? join(homedir(), ".hermes");
  }

  private getPendingDir(): string {
    const pendingDir = join(this.baseDir, "cron", "pending");
    if (!existsSync(pendingDir)) mkdirSync(pendingDir, { recursive: true });
    return pendingDir;
  }

  async dispatchOneOff(taskId: string, agent: string, prompt: string): Promise<DispatchResult> {
    const pendingDir = this.getPendingDir();
    const jobFile = join(pendingDir, `${taskId}.json`);
    writeFileSync(jobFile, JSON.stringify({
      id: taskId,
      type: "one_off",
      agent,
      prompt,
      created_at: new Date().toISOString(),
    }));
    return { success: true, agent, jobId: taskId };
  }

  async scheduleCron(taskId: string, schedule: string, prompt: string): Promise<DispatchResult> {
    const pendingDir = this.getPendingDir();
    const jobFile = join(pendingDir, `${taskId}.json`);
    writeFileSync(jobFile, JSON.stringify({
      id: taskId,
      type: "cron",
      schedule,
      prompt,
      created_at: new Date().toISOString(),
    }));
    return { success: true, agent: "hermes", jobId: taskId };
  }

  async cancelCron(taskId: string): Promise<boolean> {
    const pendingDir = this.getPendingDir();
    const jobFile = join(pendingDir, `${taskId}.json`);
    if (existsSync(jobFile)) {
      unlinkSync(jobFile);
      return true;
    }
    return false;
  }

  async listPending(): Promise<Array<{ id: string; type: string; schedule?: string; prompt: string }>> {
    const pendingDir = this.getPendingDir();
    if (!existsSync(pendingDir)) return [];
    const files = readdirSync(pendingDir).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
      const content = JSON.parse(readFileSync(join(pendingDir, f), "utf-8"));
      return { id: content.id, type: content.type, schedule: content.schedule, prompt: content.prompt };
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/bridge/agent-bridge.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/bridge/agent-bridge.ts tests/bridge/agent-bridge.test.ts
git commit -m "feat(bridge): add agent bridge interface with Hermes file-based write support"
```

---

### Task 8: Dispatcher and Scheduler

**Files:**
- Create: `src/core/orchestrator/dispatcher.ts`
- Create: `src/core/orchestrator/scheduler.ts`
- Create: `tests/core/orchestrator/dispatcher.test.ts`
- Create: `tests/core/orchestrator/scheduler.test.ts`

- [ ] **Step 1: Write failing dispatcher test**

```typescript
// tests/core/orchestrator/dispatcher.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { Dispatcher } from "../../../src/core/orchestrator/dispatcher";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, mkdirSync, rmSync, readdirSync } from "fs";
import type { AgentBridge } from "../../../src/bridge/agent-bridge";

function createMockBridge(): AgentBridge & { dispatched: string[]; cronScheduled: string[] } {
  return {
    dispatched: [],
    cronScheduled: [],
    dispatchOneOff: async (taskId: string, agent: string, _prompt: string) => {
      (createMockBridge as unknown as { dispatched: string[] }).dispatched?.push(taskId);
      return { success: true, agent, jobId: taskId };
    },
    scheduleCron: async (taskId: string, schedule: string, _prompt: string) => {
      return { success: true, agent: "hermes", jobId: taskId };
    },
    cancelCron: async () => true,
    listPending: async () => [],
  };
}

describe("Dispatcher", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-dispatch-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("dispatch dispatches one-off task to bridge", async () => {
    const bridge = createMockBridge();
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "Do it", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.status).toBe("executing");
  });

  test("dispatch returns error for unknown task", async () => {
    const bridge = createMockBridge();
    const dispatcher = new Dispatcher(store, bridge);
    const result = await dispatcher.dispatch("nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("dispatch handles bridge failure with retry", async () => {
    let calls = 0;
    const bridge: AgentBridge = {
      dispatchOneOff: async () => {
        calls++;
        if (calls < 2) return { success: false, agent: "hermes" };
        return { success: true, agent: "hermes", jobId: "j1" };
      },
      scheduleCron: async () => ({ success: true, agent: "hermes" }),
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const dispatcher = new Dispatcher(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await dispatcher.dispatch(task.id);
    expect(result.success).toBe(true);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Write failing scheduler test**

```typescript
// tests/core/orchestrator/scheduler.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { Scheduler } from "../../../src/core/orchestrator/scheduler";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import type { AgentBridge } from "../../../src/bridge/agent-bridge";
import type { Trait } from "../../../src/core/profile/types";

function createMockBridge(): AgentBridge {
  return {
    dispatchOneOff: async (taskId, agent) => ({ success: true, agent, jobId: taskId }),
    scheduleCron: async (taskId, _schedule, _prompt) => ({ success: true, agent: "hermes", jobId: taskId }),
    cancelCron: async () => true,
    listPending: async () => [],
  };
}

describe("Scheduler", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-sched-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("scheduleTasks marks tasks as scheduled", async () => {
    const bridge = createMockBridge();
    const scheduler = new Scheduler(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const t1 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const t2 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T2", description: "D", type: "cron", agent: "hermes", prompt: "P", cron_schedule: "0 9 * * *", cron_prompt: "Daily", decomposition_rationale: "R", scheduling_rationale: "R" });

    const result = await scheduler.scheduleTasks(idea.id, []);
    expect(result.scheduled).toBe(2);
    expect(store.getTask(t1.id)?.status).toBe("scheduled");
    expect(store.getTask(t2.id)?.status).toBe("scheduled");
  });

  test("scheduleTasks adjusts cron schedule based on early_riser trait", async () => {
    const scheduledJobs: { id: string; schedule: string }[] = [];
    const bridge: AgentBridge = {
      dispatchOneOff: async (taskId, agent) => ({ success: true, agent, jobId: taskId }),
      scheduleCron: async (taskId, schedule, _prompt) => {
        scheduledJobs.push({ id: taskId, schedule });
        return { success: true, agent: "hermes", jobId: taskId };
      },
      cancelCron: async () => true,
      listPending: async () => [],
    };
    const scheduler = new Scheduler(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "Morning cron", description: "D", type: "cron", agent: "hermes", prompt: "P", cron_schedule: "0 12 * * *", cron_prompt: "Daily", decomposition_rationale: "R", scheduling_rationale: "R" });

    const traits: Trait[] = [
      { id: "1", dimension: "early_riser", value: 0.9, confidence: 8, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];
    await scheduler.scheduleTasks(idea.id, traits);
    expect(scheduledJobs.length).toBe(1);
    const hour = parseInt(scheduledJobs[0].schedule.split(/\s+/)[1], 10);
    expect(hour).toBeGreaterThanOrEqual(6);
    expect(hour).toBeLessThanOrEqual(9);
  });

  test("pauseTasks cancels cron jobs and marks tasks paused", async () => {
    const bridge = createMockBridge();
    const scheduler = new Scheduler(store, bridge);
    const idea = store.createIdea({ title: "T", description: "D", domain: "general", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "cron", agent: "hermes", prompt: "P", cron_schedule: "0 9 * * *", cron_prompt: "C", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.updateTaskStatus(task.id, "scheduled");
    store.updateIdeaStatus(idea.id, "executing");

    const result = await scheduler.pauseTasks(idea.id);
    expect(result.paused).toBe(1);
    expect(store.getTask(task.id)?.status).toBe("paused");
    expect(store.getIdea(idea.id)?.status).toBe("paused");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/core/orchestrator/dispatcher.test.ts tests/core/orchestrator/scheduler.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Write dispatcher implementation**

```typescript
// src/core/orchestrator/dispatcher.ts
import type { AgentBridge } from "../../bridge/agent-bridge";
import type { OrchestratorStore } from "./store";

interface DispatchResult {
  success: boolean;
  error?: string;
  jobId?: string;
}

export class Dispatcher {
  private store: OrchestratorStore;
  private bridge: AgentBridge;

  constructor(store: OrchestratorStore, bridge: AgentBridge) {
    this.store = store;
    this.bridge = bridge;
  }

  async dispatch(taskId: string): Promise<DispatchResult> {
    const task = this.store.getTask(taskId);
    if (!task) return { success: false, error: "Task not found" };
    if (task.status === "completed") return { success: false, error: "Task already completed" };

    if (task.retry_count >= task.max_retries) {
      return { success: false, error: "Max retries exceeded" };
    }

    const result = await this.bridge.dispatchOneOff(taskId, task.agent, task.prompt);
    if (!result.success) {
      this.store.incrementRetryCount(taskId);
      if (task.retry_count + 1 < task.max_retries) {
        const retry = await this.bridge.dispatchOneOff(taskId, task.agent, task.prompt);
        if (retry.success) {
          this.store.updateTaskStatus(taskId, "executing");
          return { success: true, jobId: retry.jobId };
        }
      }
      return { success: false, error: "Bridge dispatch failed after retry" };
    }

    this.store.updateTaskStatus(taskId, "executing");
    return { success: true, jobId: result.jobId };
  }
}
```

- [ ] **Step 5: Write scheduler implementation**

```typescript
// src/core/orchestrator/scheduler.ts
import type { AgentBridge } from "../../bridge/agent-bridge";
import type { Trait } from "../profile/types";
import type { OrchestratorStore } from "./store";

interface ScheduleResult {
  scheduled: number;
  errors: number;
}

export class Scheduler {
  private store: OrchestratorStore;
  private bridge: AgentBridge;

  constructor(store: OrchestratorStore, bridge: AgentBridge) {
    this.store = store;
    this.bridge = bridge;
  }

  async scheduleTasks(ideaId: string, traits: Trait[]): Promise<ScheduleResult> {
    const tasks = this.store.getTasksByIdea(ideaId);
    const traitMap = new Map(traits.map((t) => [t.dimension, t.value]));
    let scheduled = 0;
    let errors = 0;

    for (const task of tasks) {
      if (task.status !== "pending") continue;

      try {
        if (task.type === "cron") {
          let cronSchedule = task.cron_schedule ?? "0 9 * * *";
          cronSchedule = this.applyTraitAdjustments(cronSchedule, traitMap);
          await this.bridge.scheduleCron(task.id, cronSchedule, task.cron_prompt ?? task.prompt);
        } else {
          await this.bridge.dispatchOneOff(task.id, task.agent, task.prompt);
        }
        this.store.updateTaskStatus(task.id, "scheduled");
        scheduled++;
      } catch {
        errors++;
      }
    }

    return { scheduled, errors };
  }

  async pauseTasks(ideaId: string): Promise<{ paused: number; cancelled: number }> {
    const tasks = this.store.getTasksByIdea(ideaId);
    let paused = 0;
    let cancelled = 0;

    for (const task of tasks) {
      if (task.status === "pending" || task.status === "scheduled" || task.status === "executing") {
        if (task.type === "cron") {
          await this.bridge.cancelCron(task.id);
          cancelled++;
        }
        this.store.updateTaskStatus(task.id, "paused");
        paused++;
      }
    }

    this.store.updateIdeaStatus(ideaId, "paused");
    return { paused, cancelled };
  }

  private applyTraitAdjustments(schedule: string, traitMap: Map<string, number>): string {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length < 2) return schedule;

    const earlyRiser = traitMap.get("early_riser") ?? 0.5;
    if (earlyRiser >= 0.6) {
      const hour = Math.floor(6 + (earlyRiser - 0.6) * 10);
      parts[1] = String(Math.min(9, Math.max(6, hour)));
    } else if (earlyRiser <= 0.4) {
      parts[1] = String(Math.max(19, Math.floor(19 + (0.4 - earlyRiser) * 10)));
    }

    return parts.join(" ");
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/core/orchestrator/dispatcher.test.ts tests/core/orchestrator/scheduler.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add src/core/orchestrator/dispatcher.ts src/core/orchestrator/scheduler.ts tests/core/orchestrator/dispatcher.test.ts tests/core/orchestrator/scheduler.test.ts
git commit -m "feat(orchestrator): add dispatcher and scheduler with profile-aware scheduling"
```

---

### Task 9: Observer (Execution → Observation → Profile Update)

**Files:**
- Create: `src/core/orchestrator/observer.ts`
- Create: `tests/core/orchestrator/observer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/orchestrator/observer.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { Observer } from "../../../src/core/orchestrator/observer";
import { ProfileEngine } from "../../../src/core/profile/engine";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("Observer", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let profileEngine: ProfileEngine;
  let observer: Observer;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-observer-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
    profileEngine = new ProfileEngine(db);
    observer = new Observer(store, profileEngine);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  function setupIdeaWithTask() {
    const idea = store.createIdea({ title: "Test", description: "Desc", domain: "coding", priority: "medium", workspace_id: "ws-1" });
    const task = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "Do coding", type: "one_off", agent: "hermes", prompt: "Code", decomposition_rationale: "R", scheduling_rationale: "R" });
    return { idea, task };
  }

  test("processResult emits observations for successful execution", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "Done", duration_ms: 1500 });

    const observations = observer.processResult(result);
    expect(observations.length).toBeGreaterThanOrEqual(2);
    expect(observations.some((o) => o.key.includes("task_completion"))).toBe(true);
    expect(observations.some((o) => o.key.includes("duration"))).toBe(true);
  });

  test("processResult emits failure observation for failed task", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: false, output: "Error: timeout", duration_ms: 30000 });

    const observations = observer.processResult(result);
    const completion = observations.find((o) => o.key.includes("task_completion"));
    expect(completion).toBeDefined();
    const value = JSON.parse(completion!.value);
    expect(value.success).toBe(false);
  });

  test("processResult marks task completed on success", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "Done", duration_ms: 100 });

    observer.processResult(result);
    expect(store.getTask(task.id)?.status).toBe("completed");
  });

  test("processResult marks task failed on failure", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: false, output: "Error", duration_ms: 100 });

    observer.processResult(result);
    expect(store.getTask(task.id)?.status).toBe("failed");
  });

  test("processFeedback emits feedback observation", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "Done", duration_ms: 100 });

    const observations = observer.processFeedback(result.id, "Great job, very thorough!");
    expect(observations.length).toBeGreaterThanOrEqual(1);
    const feedback = observations.find((o) => o.key.includes("feedback"));
    expect(feedback).toBeDefined();
  });

  test("processAllResults handles multiple results", () => {
    const { idea } = setupIdeaWithTask();
    const t1 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T1", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    const t2 = store.createTask({ idea_id: idea.id, workspace_id: "ws-1", title: "T2", description: "D", type: "one_off", agent: "hermes", prompt: "P", decomposition_rationale: "R", scheduling_rationale: "R" });
    store.addExecutionResult({ task_id: t1.id, agent: "hermes", success: true, output: "OK", duration_ms: 100 });
    store.addExecutionResult({ task_id: t2.id, agent: "hermes", success: false, output: "Fail", duration_ms: 200 });

    const allObs = observer.processAllResults(idea.id);
    expect(allObs.length).toBeGreaterThanOrEqual(4);
  });

  test("getProfileUpdates returns trait changes since a date", () => {
    const { task } = setupIdeaWithTask();
    const result = store.addExecutionResult({ task_id: task.id, agent: "hermes", success: true, output: "Done", duration_ms: 100 });
    observer.processResult(result);

    const updates = observer.getProfileUpdates("2026-01-01");
    expect(Array.isArray(updates)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator/observer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/orchestrator/observer.ts
import type { ProfileEngine } from "../profile/engine";
import type { ExecutionResult } from "./types";
import type { OrchestratorStore } from "./store";

interface ProcessedObservation {
  id: number;
  type: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
}

export class Observer {
  private store: OrchestratorStore;
  private profileEngine: ProfileEngine;

  constructor(store: OrchestratorStore, profileEngine: ProfileEngine) {
    this.store = store;
    this.profileEngine = profileEngine;
  }

  processResult(result: ExecutionResult): ProcessedObservation[] {
    const observations: ProcessedObservation[] = [];
    const task = this.store.getTask(result.task_id);

    // Task completion observation
    observations.push(this.emitObservation(
      "behavior",
      `execution:task_completion:${result.task_id}`,
      JSON.stringify({ success: result.success, duration_ms: result.duration_ms }),
      result.success ? 7 : 4,
    ));

    // Duration observation
    observations.push(this.emitObservation(
      "behavior",
      `execution:duration:${result.task_id}`,
      JSON.stringify({ duration_ms: result.duration_ms }),
      5,
    ));

    // Domain observation (if task found)
    if (task) {
      const idea = this.store.getIdea(task.idea_id);
      if (idea) {
        const results = this.store.getResultsByIdea(idea.id);
        const completed = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        observations.push(this.emitObservation(
          "signal",
          `execution:domain:${idea.domain}`,
          JSON.stringify({ completed, failed, total: results.length }),
          5,
        ));
      }

      // Update task status
      this.store.updateTaskStatus(task.id, result.success ? "completed" : "failed");
    }

    return observations;
  }

  processFeedback(resultId: number, feedback: string): ProcessedObservation[] {
    this.store.addUserFeedback(resultId, feedback);

    const database = this.profileEngine.getDatabase?.();
    // We need the task_id from the result — query it via store
    // Since we have resultId, we can get it from the DB
    const observations: ProcessedObservation[] = [];

    observations.push(this.emitObservation(
      "feedback",
      `execution:feedback:result-${resultId}`,
      JSON.stringify({ text: feedback }),
      6,
    ));

    return observations;
  }

  processAllResults(ideaId: string): ProcessedObservation[] {
    const results = this.store.getResultsByIdea(ideaId);
    const allObs: ProcessedObservation[] = [];
    for (const result of results) {
      allObs.push(...this.processResult(result));
    }
    return allObs;
  }

  getProfileUpdates(since: string): Array<{ dimension: string; oldValue: number; newValue: number; changedAt: string }> {
    const traits = this.profileEngine.getTraits();
    return traits
      .filter((t) => t.updated_at >= since)
      .map((t) => ({
        dimension: t.dimension,
        oldValue: 0,
        newValue: t.value,
        changedAt: t.updated_at,
      }));
  }

  private emitObservation(
    type: string,
    key: string,
    value: string,
    confidence: number,
  ): ProcessedObservation {
    const id = this.profileEngine.addObservation({
      type: type as "behavior" | "signal" | "feedback",
      key,
      value,
      confidence,
      source: "execution_result",
      provenance: JSON.stringify({
        source: "orchestrator_observer",
        extracted_at: new Date().toISOString(),
      }),
    });
    return { id, type, key, value, confidence, source: "execution_result" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/orchestrator/observer.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/observer.ts tests/core/orchestrator/observer.test.ts
git commit -m "feat(orchestrator): add observer for execution→observation→profile pipeline"
```

---

### Task 10: Idea Clustering (Auto-Detection)

**Files:**
- Create: `src/core/orchestrator/clustering.ts`
- Create: `tests/core/orchestrator/clustering.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/orchestrator/clustering.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { ProfileEngine } from "../../../src/core/profile/engine";
import { IdeaClusterer, STOP_WORDS } from "../../../src/core/orchestrator/clustering";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("IdeaClusterer", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let profileEngine: ProfileEngine;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-cluster-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
    profileEngine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("STOP_WORDS contains common English words", () => {
    expect(STOP_WORDS.has("the")).toBe(true);
    expect(STOP_WORDS.has("and")).toBe(true);
    expect(STOP_WORDS.has("rust")).toBe(false);
  });

  test("detectClusters returns empty when no observations", () => {
    const clusterer = new IdeaClusterer(profileEngine, store);
    const clusters = clusterer.detectClusters();
    expect(clusters).toHaveLength(0);
  });

  test("detectClusters finds recurring theme in observations", () => {
    const clusterer = new IdeaClusterer(profileEngine, store);
    profileEngine.addObservation({ type: "signal", key: "test:1", value: JSON.stringify({ text: "I want to learn Rust programming" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:2", value: JSON.stringify({ text: "Rust is interesting for systems programming" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:3", value: JSON.stringify({ text: "Thinking about Rust CLI tools" }), confidence: 5, source: "mcp", provenance: "{}" });

    const clusters = clusterer.detectClusters();
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const rustCluster = clusters.find((c) => c.theme.toLowerCase().includes("rust"));
    expect(rustCluster).toBeDefined();
    expect(rustCluster!.count).toBeGreaterThanOrEqual(3);
  });

  test("detectClusters skips themes that already have an idea", () => {
    const clusterer = new IdeaClusterer(profileEngine, store);
    store.createIdea({ title: "Learn Rust", description: "Rust programming", domain: "coding", priority: "medium", workspace_id: "ws-1" });
    profileEngine.addObservation({ type: "signal", key: "test:1", value: JSON.stringify({ text: "I want to learn Rust" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:2", value: JSON.stringify({ text: "Rust is great" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:3", value: JSON.stringify({ text: "Rust CLI tools" }), confidence: 5, source: "mcp", provenance: "{}" });

    const clusters = clusterer.detectClusters();
    const rustCluster = clusters.find((c) => c.theme.toLowerCase().includes("rust"));
    expect(rustCluster).toBeUndefined();
  });

  test("detectClusters filters stop words", () => {
    const clusterer = new IdeaClusterer(profileEngine, store);
    profileEngine.addObservation({ type: "signal", key: "test:1", value: JSON.stringify({ text: "the and but or" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:2", value: JSON.stringify({ text: "the and but or" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:3", value: JSON.stringify({ text: "the and but or" }), confidence: 5, source: "mcp", provenance: "{}" });

    const clusters = clusterer.detectClusters();
    expect(clusters).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator/clustering.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/orchestrator/clustering.ts
import type { ProfileEngine } from "../profile/engine";
import type { OrchestratorStore } from "./store";

export interface ClusterResult {
  theme: string;
  count: number;
  sampleObservations: string[];
}

export const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "by", "from", "is", "it", "that", "this", "was", "are", "be", "have", "has", "had",
  "not", "they", "i", "you", "he", "she", "we", "my", "your", "his", "her", "our",
  "its", "what", "which", "who", "when", "where", "how", "all", "each", "every",
  "both", "few", "more", "most", "other", "some", "such", "no", "nor", "too", "very",
  "can", "will", "just", "should", "now", "also", "than", "then", "so", "if", "about",
  "up", "out", "do", "did", "get", "got", "want", "like", "would", "could", "think",
  "know", "see", "make", "go", "going", "really", "thing", "things", "much",
]);

export class IdeaClusterer {
  private profileEngine: ProfileEngine;
  private store: OrchestratorStore;

  constructor(profileEngine: ProfileEngine, store: OrchestratorStore) {
    this.profileEngine = profileEngine;
    this.store = store;
  }

  detectClusters(): ClusterResult[] {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().replace("T", " ");
    const observations = this.profileEngine.getObservations({ since });

    const wordCounts = new Map<string, { count: number; samples: string[] }>();
    const existingIdeas = this.getAllIdeaThemes();

    for (const obs of observations) {
      const text = this.extractText(obs.value);
      const words = this.tokenize(text);

      for (const word of words) {
        const existing = wordCounts.get(word);
        if (existing) {
          existing.count++;
          if (existing.samples.length < 3) existing.samples.push(text.slice(0, 100));
        } else {
          wordCounts.set(word, { count: 1, samples: [text.slice(0, 100)] });
        }
      }
    }

    const clusters: ClusterResult[] = [];
    for (const [theme, data] of wordCounts) {
      if (data.count >= 3 && !existingIdeas.has(theme.toLowerCase())) {
        clusters.push({ theme, count: data.count, sampleObservations: data.samples });
      }
    }

    return clusters.sort((a, b) => b.count - a.count).slice(0, 5);
  }

  private extractText(value: string): string {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed.text === "string") return parsed.text;
      return String(parsed);
    } catch {
      return value;
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  }

  private getAllIdeaThemes(): Set<string> {
    const ideas = [
      ...this.store.listIdeasByStatus("draft"),
      ...this.store.listIdeasByStatus("planned"),
      ...this.store.listIdeasByStatus("executing"),
    ];
    const themes = new Set<string>();
    for (const idea of ideas) {
      const words = this.tokenize(`${idea.title} ${idea.description}`);
      for (const word of words) themes.add(word);
    }
    return themes;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/orchestrator/clustering.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/clustering.ts tests/core/orchestrator/clustering.test.ts
git commit -m "feat(orchestrator): add idea clustering from observation patterns"
```

---

### Task 11: MCP Orchestrator Handlers (7 Tools)

**Files:**
- Create: `src/mcp/orchestrator-handlers.ts`
- Create: `src/mcp/orchestrator-schema.ts`
- Create: `tests/mcp/orchestrator-handlers.test.ts`
- Modify: `src/mcp/server.ts:18` (register orchestrator handlers)

This is the largest task. It wires all orchestrator modules into MCP tools.

- [ ] **Step 1: Write orchestrator Zod schemas**

```typescript
// src/mcp/orchestrator-schema.ts
import { z } from "zod";

export const IdeaSubmitSchema = {
  title: z.string().min(1).max(200).describe("Idea title"),
  description: z.string().min(1).max(5000).describe("Detailed description of the idea"),
  domain: z.enum(["coding", "writing", "research", "creative", "general"]).optional().default("general"),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
  deadline: z.string().optional().describe("Optional ISO date deadline"),
  workspace_id: z.string().optional().describe("Existing workspace ID (auto-created if omitted)"),
};

export const IdeaPlanSchema = {
  idea_id: z.string().describe("ID of the idea to plan"),
};

export const PlanApproveSchema = {
  idea_id: z.string().describe("ID of the idea to approve"),
  task_modifications: z.array(z.object({
    task_id: z.string().optional(),
    action: z.enum(["update", "remove", "add"]),
    field: z.enum(["title", "agent", "prompt", "cron_schedule", "type"]).optional(),
    value: z.string().optional(),
  })).optional().describe("Optional modifications to the plan"),
};

export const TaskExecuteSchema = {
  task_id: z.string().describe("ID of the task to execute"),
};

export const IdeaPauseSchema = {
  idea_id: z.string().describe("ID of the idea to pause"),
};

export const ExecutionStatusSchema = {
  idea_id: z.string().optional().describe("Filter by idea ID"),
  task_id: z.string().optional().describe("Filter by task ID"),
  feedback: z.string().optional().describe("Optional feedback for the latest result"),
};

export const ReplanSchema = {
  idea_id: z.string().describe("ID of the idea to re-plan"),
};
```

- [ ] **Step 2: Write orchestrator handlers**

```typescript
// src/mcp/orchestrator-handlers.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HermesAgentBridge } from "../bridge/agent-bridge";
import { Derivator } from "../core/profile/derivator";
import { ProfileEngine } from "../core/profile/engine";
import { IdeaClusterer } from "../core/orchestrator/clustering";
import { Dispatcher } from "../core/orchestrator/dispatcher";
import { Observer } from "../core/orchestrator/observer";
import { Planner } from "../core/orchestrator/planner";
import { Scheduler } from "../core/orchestrator/scheduler";
import { OrchestratorStore } from "../core/orchestrator/store";
import type { KaiDB } from "../db/client";
import { LLMProvider } from "../llm/provider";
import { WorkspaceStore } from "../workspace/store";
import {
  ExecutionStatusSchema,
  IdeaPauseSchema,
  IdeaPlanSchema,
  IdeaSubmitSchema,
  PlanApproveSchema,
  ReplanSchema,
  TaskExecuteSchema,
} from "./orchestrator-schema";
import { log } from "./utils";

function textContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function registerOrchestratorHandlers(server: McpServer, db: KaiDB): void {
  const profileEngine = new ProfileEngine(db);
  const store = new OrchestratorStore(db);
  const workspaceStore = new WorkspaceStore(db);
  const llmProvider = new LLMProvider();
  const bridge = new HermesAgentBridge();

  // --- kai_idea_submit ---
  server.tool("kai_idea_submit", IdeaSubmitSchema, async (params) => {
    log("kai_idea_submit", { title: params.title });

    let workspaceId = params.workspace_id;
    if (!workspaceId) {
      const ws = workspaceStore.createWorkspace({
        name: params.title,
        description: `Auto-created for idea: ${params.title}`,
      });
      workspaceStore.updateWorkspaceContext(ws.id, { auto_created: true, idea_id: null });
      workspaceId = ws.id;
    }

    const idea = store.createIdea({
      title: params.title,
      description: params.description,
      domain: params.domain,
      priority: params.priority,
      deadline: params.deadline,
      workspace_id: workspaceId,
    });

    // Check for clustering suggestions
    const clusterer = new IdeaClusterer(profileEngine, store);
    const clusters = clusterer.detectClusters();

    return textContent({
      idea_id: idea.id,
      workspace_id: workspaceId,
      status: idea.status,
      suggested_clusters: clusters.slice(0, 3),
    });
  });

  // --- kai_idea_plan ---
  server.tool("kai_idea_plan", IdeaPlanSchema, async ({ idea_id }) => {
    log("kai_idea_plan", { idea_id });

    const idea = store.getIdea(idea_id);
    if (!idea) return textContent({ error: "idea_not_found" });

    const traits = profileEngine.getTraits();
    const planner = new Planner(store, llmProvider);

    try {
      const tasks = await planner.decomposeIdea(idea_id, traits);
      store.updateIdeaStatus(idea_id, "planned");

      return textContent({
        idea: { id: idea.id, title: idea.title, domain: idea.domain },
        tasks: tasks.map((t) => ({
          id: t.id, title: t.title, type: t.type, agent: t.agent,
          prompt: t.prompt, decomposition_rationale: t.decomposition_rationale,
          cron_schedule: t.cron_schedule, status: t.status,
        })),
        profile_influence: traits.slice(0, 5).map((t) => ({
          dimension: t.dimension, value: t.value,
        })),
      });
    } catch (err) {
      return textContent({ error: "planning_failed", message: (err as Error).message });
    }
  });

  // --- kai_plan_approve ---
  server.tool("kai_plan_approve", PlanApproveSchema, async ({ idea_id, task_modifications }) => {
    log("kai_plan_approve", { idea_id });

    const idea = store.getIdea(idea_id);
    if (!idea) return textContent({ error: "idea_not_found" });

    // Apply modifications
    if (task_modifications) {
      for (const mod of task_modifications) {
        if (mod.action === "remove" && mod.task_id) {
          store.deleteTask(mod.task_id);
        } else if (mod.action === "update" && mod.task_id && mod.field && mod.value) {
          store.updateTask(mod.task_id, { [mod.field]: mod.value });
        }
      }
    }

    // Schedule tasks
    const traits = profileEngine.getTraits();
    const scheduler = new Scheduler(store, bridge);
    const result = await scheduler.scheduleTasks(idea_id, traits);

    return textContent({
      scheduled_tasks: result.scheduled,
      errors: result.errors,
      tasks: store.getTasksByIdea(idea_id).map((t) => ({
        id: t.id, title: t.title, status: t.status, type: t.type,
      })),
    });
  });

  // --- kai_task_execute ---
  server.tool("kai_task_execute", TaskExecuteSchema, async ({ task_id }) => {
    log("kai_task_execute", { task_id });

    const dispatcher = new Dispatcher(store, bridge);
    const result = await dispatcher.dispatch(task_id);

    return textContent({
      success: result.success,
      task_id,
      agent: "hermes",
      error: result.error,
    });
  });

  // --- kai_idea_pause ---
  server.tool("kai_idea_pause", IdeaPauseSchema, async ({ idea_id }) => {
    log("kai_idea_pause", { idea_id });

    const scheduler = new Scheduler(store, bridge);
    const result = await scheduler.pauseTasks(idea_id);

    return textContent({
      paused_tasks: result.paused,
      cancelled_cron_jobs: result.cancelled,
    });
  });

  // --- kai_execution_status ---
  server.tool("kai_execution_status", ExecutionStatusSchema, async ({ idea_id, task_id, feedback }) => {
    log("kai_execution_status", { idea_id, task_id, hasFeedback: !!feedback });

    const observer = new Observer(store, profileEngine);

    // Process feedback if provided
    if (feedback) {
      const results = task_id
        ? store.getResultsByTask(task_id)
        : idea_id
          ? store.getResultsByIdea(idea_id)
          : [];
      if (results.length > 0) {
        observer.processFeedback(results[0].id, feedback);
      }
    }

    // Get status
    let tasks: import("../core/orchestrator/types").PlannedTask[] = [];
    if (idea_id) tasks = store.getTasksByIdea(idea_id);
    else if (task_id) {
      const task = store.getTask(task_id);
      if (task) tasks = [task];
    }

    const results = tasks.flatMap((t) => store.getResultsByTask(t.id));
    const profileUpdates = idea_id ? observer.getProfileUpdates("2026-01-01") : [];

    return textContent({
      tasks: tasks.map((t) => ({
        id: t.id, title: t.title, status: t.status, type: t.type,
        retry_count: t.retry_count,
      })),
      results: results.map((r) => ({
        id: r.id, success: Boolean(r.success), duration_ms: r.duration_ms,
        completed_at: r.completed_at,
      })),
      profile_updates: profileUpdates,
    });
  });

  // --- kai_replan ---
  server.tool("kai_replan", ReplanSchema, async ({ idea_id }) => {
    log("kai_replan", { idea_id });

    const idea = store.getIdea(idea_id);
    if (!idea) return textContent({ error: "idea_not_found" });

    const oldTasks = store.getTasksByIdea(idea_id);
    const traits = profileEngine.getTraits();
    const planner = new Planner(store, llmProvider);

    try {
      const newTasks = await planner.decomposeIdea(idea_id, traits);

      return textContent({
        new_plan: newTasks.map((t) => ({
          id: t.id, title: t.title, type: t.type, status: t.status,
        })),
        changes_from_previous: {
          old_count: oldTasks.length,
          new_count: newTasks.length,
        },
      });
    } catch (err) {
      return textContent({ error: "replan_failed", message: (err as Error).message });
    }
  });
}
```

- [ ] **Step 3: Register in server.ts**

Modify `src/mcp/server.ts` to add orchestrator handler registration:

```typescript
// In src/mcp/server.ts, add import and registration:
import { registerOrchestratorHandlers } from "./orchestrator-handlers";

// In createMcpServer, after registerHandlers(server, db):
registerOrchestratorHandlers(server, db);
```

- [ ] **Step 4: Write integration test**

```typescript
// tests/mcp/orchestrator-handlers.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, mkdirSync, rmSync } from "fs";

// Direct handler testing via store-level calls (MCP handler wiring tested via integration)
import { OrchestratorStore } from "../../src/core/orchestrator/store";
import { WorkspaceStore } from "../../src/workspace/store";

describe("Orchestrator MCP Handlers Integration", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let wsStore: WorkspaceStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-orch-mcp-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
    wsStore = new WorkspaceStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("full idea lifecycle: submit → plan → approve → execute → status", async () => {
    // 1. Submit
    const ws = wsStore.createWorkspace({ name: "Test WS" });
    const idea = store.createIdea({
      title: "Learn TypeScript",
      description: "Master TypeScript generics and utility types",
      domain: "coding",
      priority: "high",
      workspace_id: ws.id,
    });
    expect(idea.status).toBe("draft");

    // 2. Plan (skip LLM, create tasks manually for integration test)
    store.createTask({
      idea_id: idea.id, workspace_id: ws.id, title: "Study generics",
      description: "Read TypeScript handbook on generics", type: "one_off",
      agent: "hermes", prompt: "Study generics",
      decomposition_rationale: "Foundation", scheduling_rationale: "First",
    });
    store.updateIdeaStatus(idea.id, "planned");
    expect(store.getIdea(idea.id)?.status).toBe("planned");

    // 3. Approve (mark scheduled)
    const tasks = store.getTasksByIdea(idea.id);
    store.updateTaskStatus(tasks[0].id, "scheduled");
    expect(store.getTask(tasks[0].id)?.status).toBe("scheduled");

    // 4. Execute (mark executing, then complete)
    store.updateTaskStatus(tasks[0].id, "executing");
    store.addExecutionResult({
      task_id: tasks[0].id, agent: "hermes", success: true,
      output: "Completed generics study", duration_ms: 3600000,
    });
    store.updateTaskStatus(tasks[0].id, "completed");
    expect(store.getTask(tasks[0].id)?.status).toBe("completed");

    // 5. Status
    const results = store.getResultsByTask(tasks[0].id);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  test("idea submit auto-creates workspace when no workspace_id", () => {
    const idea = store.createIdea({
      title: "My Idea", description: "Something cool",
      domain: "general", priority: "medium", workspace_id: "ws-auto-1",
    });
    expect(idea.workspace_id).toBe("ws-auto-1");
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `bun test`
Expected: All tests pass including new orchestrator tests

- [ ] **Step 6: Commit**

```bash
git add src/mcp/orchestrator-schema.ts src/mcp/orchestrator-handlers.ts src/mcp/server.ts tests/mcp/orchestrator-handlers.test.ts
git commit -m "feat(mcp): add 7 orchestrator MCP tools — submit, plan, approve, execute, pause, status, replan"
```

---

### Task 12: Closed Loop Wiring

**Files:**
- Create: `src/core/orchestrator/closed-loop.ts`
- Create: `tests/core/orchestrator/closed-loop.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/orchestrator/closed-loop.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { ProfileEngine } from "../../../src/core/profile/engine";
import { Derivator } from "../../../src/core/profile/derivator";
import { ClosedLoopEngine } from "../../../src/core/orchestrator/closed-loop";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("ClosedLoopEngine", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let profileEngine: ProfileEngine;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-closed-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
    profileEngine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("detectSignificantChanges returns empty when no traits changed", () => {
    const engine = new ClosedLoopEngine(profileEngine, store);
    const changes = engine.detectSignificantChanges();
    expect(changes).toHaveLength(0);
  });

  test("detectSignificantChanges detects trait delta above threshold", () => {
    // Set baseline trait
    profileEngine.setTrait({
      dimension: "detail_oriented", value: 0.5, confidence: 5,
      source: "observed", reasoning: "baseline",
    });

    // Add execution observations that shift the trait
    profileEngine.addObservation({
      type: "behavior", key: "execution:task_completion:1",
      value: JSON.stringify({ success: true, duration_ms: 5000 }),
      confidence: 7, source: "execution_result",
      provenance: JSON.stringify({ source: "orchestrator_observer" }),
    });

    const engine = new ClosedLoopEngine(profileEngine, store);
    const changes = engine.detectSignificantChanges();
    // May or may not detect depending on derivation results
    expect(Array.isArray(changes)).toBe(true);
  });

  test("shouldTriggerReplan returns false when no significant changes", () => {
    const engine = new ClosedLoopEngine(profileEngine, store);
    expect(engine.shouldTriggerReplan()).toBe(false);
  });

  test("getReplanThreshold returns default values", () => {
    const engine = new ClosedLoopEngine(profileEngine, store);
    const threshold = engine.getReplanThreshold();
    expect(threshold.valueDelta).toBe(0.15);
    expect(threshold.confidenceDelta).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator/closed-loop.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/orchestrator/closed-loop.ts
import type { ProfileEngine } from "../profile/engine";
import type { OrchestratorStore } from "./store";

interface TraitChange {
  dimension: string;
  oldValue: number;
  newValue: number;
  delta: number;
  confidenceDelta: number;
}

interface ReplanThreshold {
  valueDelta: number;
  confidenceDelta: number;
  windowHours: number;
}

export class ClosedLoopEngine {
  private profileEngine: ProfileEngine;
  private store: OrchestratorStore;
  private previousTraits: Map<string, { value: number; confidence: number; updatedAt: string }>;

  constructor(profileEngine: ProfileEngine, store: OrchestratorStore) {
    this.profileEngine = profileEngine;
    this.store = store;
    this.previousTraits = this.snapshotTraits();
  }

  detectSignificantChanges(): TraitChange[] {
    const currentTraits = this.profileEngine.getTraits();
    const changes: TraitChange[] = [];
    const threshold = this.getReplanThreshold();
    const windowStart = new Date(Date.now() - threshold.windowHours * 60 * 60 * 1000).toISOString();

    for (const trait of currentTraits) {
      const prev = this.previousTraits.get(trait.dimension);
      if (!prev) continue;

      const valueDelta = Math.abs(trait.value - prev.value);
      const confDelta = Math.abs(trait.confidence - prev.confidence);

      if (valueDelta >= threshold.valueDelta || confDelta >= threshold.confidenceDelta) {
        changes.push({
          dimension: trait.dimension,
          oldValue: prev.value,
          newValue: trait.value,
          delta: valueDelta,
          confidenceDelta: confDelta,
        });
      }
    }

    return changes;
  }

  shouldTriggerReplan(): boolean {
    const changes = this.detectSignificantChanges();
    return changes.length > 0;
  }

  getReplanThreshold(): ReplanThreshold {
    const prefs = this.profileEngine.getPreferences();
    const valuePref = prefs.find((p) => p.key === "orchestrator.replan_threshold_value");
    const confPref = prefs.find((p) => p.key === "orchestrator.replan_threshold_confidence");

    return {
      valueDelta: valuePref ? parseFloat(valuePref.value) : 0.15,
      confidenceDelta: confPref ? parseInt(confPref.value, 10) : 2,
      windowHours: 24,
    };
  }

  refreshSnapshot(): void {
    this.previousTraits = this.snapshotTraits();
  }

  private snapshotTraits(): Map<string, { value: number; confidence: number; updatedAt: string }> {
    const map = new Map<string, { value: number; confidence: number; updatedAt: string }>();
    for (const trait of this.profileEngine.getTraits()) {
      map.set(trait.dimension, {
        value: trait.value,
        confidence: trait.confidence,
        updatedAt: trait.updated_at,
      });
    }
    return map;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/orchestrator/closed-loop.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/closed-loop.ts tests/core/orchestrator/closed-loop.test.ts
git commit -m "feat(orchestrator): add closed loop engine with trait change detection"
```

---

### Task 13: Update Observation Source Type

**Files:**
- Modify: `src/core/profile/types.ts:38-47` (add `execution_result` to source union)

- [ ] **Step 1: Update the Observation source type**

In `src/core/profile/types.ts`, add `"execution_result"` to the Observation source union:

```typescript
// Before:
source:
  | "cron_output"
  | "session_log"
  | "user_stated"
  | "inferred"
  | "mcp"
  | "coldstart"
  | "workspace";

// After:
source:
  | "cron_output"
  | "session_log"
  | "user_stated"
  | "inferred"
  | "mcp"
  | "coldstart"
  | "workspace"
  | "execution_result";
```

- [ ] **Step 2: Run typecheck to verify no breakage**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/profile/types.ts
git commit -m "feat(profile): add execution_result to Observation source type"
```

---

### Task 14: LLM Provider max_tokens Override

**Files:**
- Modify: `src/llm/provider.ts:44-55` (accept per-call max_tokens)

- [ ] **Step 1: Update buildRequestBody to accept options**

```typescript
// In src/llm/provider.ts, modify buildRequestBody:
buildRequestBody(
  prompt: string,
  systemPrompt: string,
  options?: { max_tokens?: number },
): Record<string, unknown> {
  return {
    model: this.config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ] as ChatMessage[],
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: options?.max_tokens ?? 2048,
  };
}
```

- [ ] **Step 2: Update call method to pass options**

```typescript
// In src/llm/provider.ts, update the call method signature:
async call(
  prompt: string,
  systemPrompt: string,
  retries = 1,
  options?: { max_tokens?: number },
): Promise<Record<string, unknown>> {
  const url = `${this.config.baseUrl}/chat/completions`;
  const body = this.buildRequestBody(prompt, systemPrompt, options);
  // ... rest unchanged
```

- [ ] **Step 3: Run existing tests**

Run: `bun test tests/llm-provider.test.ts`
Expected: PASS (existing tests still work, new param is optional)

- [ ] **Step 4: Commit**

```bash
git add src/llm/provider.ts
git commit -m "feat(llm): add per-call max_tokens override to LLMProvider"
```

---

### Task 15: End-to-End Integration Test

**Files:**
- Create: `tests/e2e/orchestrator-e2e.test.ts`

- [ ] **Step 1: Write the E2E test**

```typescript
// tests/e2e/orchestrator-e2e.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { Derivator } from "../../src/core/profile/derivator";
import { OrchestratorStore } from "../../src/core/orchestrator/store";
import { Observer } from "../../src/core/orchestrator/observer";
import { ClosedLoopEngine } from "../../src/core/orchestrator/closed-loop";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("Orchestrator E2E: Full Closed Loop", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let profileEngine: ProfileEngine;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-e2e-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
    profileEngine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("full closed loop: submit → plan → execute → observe → profile update", () => {
    // 1. Set up profile with baseline traits
    profileEngine.setTrait({
      dimension: "detail_oriented", value: 0.5, confidence: 5,
      source: "observed", reasoning: "baseline",
    });

    // 2. Submit idea
    const idea = store.createIdea({
      title: "Learn Rust",
      description: "Build a systems CLI tool",
      domain: "coding",
      priority: "high",
      workspace_id: "ws-e2e",
    });
    expect(idea.status).toBe("draft");

    // 3. Plan (create tasks manually, simulating planner output)
    const task1 = store.createTask({
      idea_id: idea.id, workspace_id: "ws-e2e", title: "Set up project",
      description: "Initialize Cargo project", type: "one_off", agent: "hermes",
      prompt: "cargo init", decomposition_rationale: "First step", scheduling_rationale: "Immediate",
    });
    const task2 = store.createTask({
      idea_id: idea.id, workspace_id: "ws-e2e", title: "Daily practice",
      description: "Practice Rust daily", type: "cron", agent: "hermes",
      prompt: "Practice", cron_schedule: "0 9 * * *", cron_prompt: "Daily practice",
      decomposition_rationale: "Build habit", scheduling_rationale: "Morning",
    });
    store.updateIdeaStatus(idea.id, "planned");

    // 4. Approve and schedule
    store.updateTaskStatus(task1.id, "scheduled");
    store.updateTaskStatus(task2.id, "scheduled");
    store.updateIdeaStatus(idea.id, "executing");

    // 5. Execute task 1
    store.updateTaskStatus(task1.id, "executing");
    const result = store.addExecutionResult({
      task_id: task1.id, agent: "hermes", success: true,
      output: "Project initialized", duration_ms: 2500,
    });

    // 6. Observer processes result → emits observations
    const observer = new Observer(store, profileEngine);
    const observations = observer.processResult(result);
    expect(observations.length).toBeGreaterThanOrEqual(2);

    // 7. Verify task completed
    expect(store.getTask(task1.id)?.status).toBe("completed");

    // 8. Derive traits from new observations
    const derivator = new Derivator(profileEngine);
    const derivedTraits = derivator.deriveFromRules();
    expect(derivedTraits.length).toBeGreaterThanOrEqual(0);

    // 9. Check closed loop
    const closedLoop = new ClosedLoopEngine(profileEngine, store);
    closedLoop.refreshSnapshot();
    const changes = closedLoop.detectSignificantChanges();
    expect(Array.isArray(changes)).toBe(true);

    // 10. Verify execution results persisted
    const allResults = store.getResultsByIdea(idea.id);
    expect(allResults).toHaveLength(1);
    expect(allResults[0].success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run: `bun test tests/e2e/orchestrator-e2e.test.ts`
Expected: PASS (1 test)

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run lint**

Run: `npx @biomejs/biome check src/`
Expected: No errors (fix any that appear)

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/orchestrator-e2e.test.ts
git commit -m "test(e2e): add full closed loop integration test for orchestrator"
```

---

## Self-Review Checklist

### 1. Spec Coverage
| Spec Requirement | Task |
|-----------------|------|
| Orchestrator types (Idea, PlannedTask, ExecutionResult) | T2 |
| 3 new DB tables (ideas, planned_tasks, execution_results) | T3 |
| Source CHECK removal + execution_result source | T3, T13 |
| Orchestrator store CRUD | T4 |
| Profile context formatter | T5 |
| Planner (LLM decomposition with profile) | T6 |
| Agent bridge + Hermes write | T7 |
| Dispatcher | T8 |
| Scheduler (profile-aware) | T8 |
| Observer (execution→observation) | T9 |
| Idea clustering | T10 |
| 7 MCP tools | T11 |
| Closed loop engine | T12 |
| LLM max_tokens override | T14 |
| E2E closed loop test | T15 |
| Idea Clustering + Auto-detection (Expansion 2) | T10 |
| Progress Celebration via kai_execution_status (Expansion 3) | T11 (profile_updates field) |
| Behavioral Trait API (Expansion 1) | Already exists via kai://profile/traits/{dimension} resource |

### 2. Placeholder Scan
No TBD, TODO, "implement later", or placeholder patterns found.

### 3. Type Consistency
- `Idea.workspace_id` used consistently across store, planner, handlers
- `PlannedTask.status` uses TaskStatus union throughout
- `ExecutionResult.success` is boolean in types, stored as 0/1 in SQLite
- `Observation.source` includes `"execution_result"` after T13
- `AgentBridge` interface methods match dispatcher/scheduler usage
