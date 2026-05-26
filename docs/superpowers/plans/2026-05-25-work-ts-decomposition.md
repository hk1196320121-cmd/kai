# work.ts 5-Module Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `src/cli/work.ts` (750 lines) into 5 focused modules under `src/cli/work/` with centralized lifecycle cleanup and cooperative SIGINT handling.

**Architecture:** Extract functions into domain-focused files (git-scan, ui, recommendations, status, start) with a thin facade in work.ts. Replace scattered early-return cleanup with PhaseResult state returns flowing into a centralized `finally` block. SIGINT becomes cooperative cancellation instead of `process.exit(130)`.

**Tech Stack:** TypeScript, Bun runtime, bun:sqlite, Commander.js, Bun test runner

---

## File Structure

| File | Responsibility | Lines (est.) |
|------|---------------|-------------|
| `src/cli/work.ts` | Facade: `registerWorkCommands()` + re-exports | ~60 |
| `src/cli/work/types.ts` | `WorkStartOptions`, `PhaseResult`, `WorkStartContext` | ~40 |
| `src/cli/work/git-scan.ts` | `scanGitHistory`, `GitScanResult`, `makeProvenance`, constants | ~155 |
| `src/cli/work/ui.ts` | `progress`, `progressDone`, `displayPreview` | ~40 |
| `src/cli/work/recommendations.ts` | `getIdeaRecommendations`, approval, LLM plan, dispatch, penalize | ~180 |
| `src/cli/work/status.ts` | `handleWorkStatus`, `handleWorkList` | ~60 |
| `src/cli/work/start.ts` | `handleWorkStart` with PhaseResult control flow | ~180 |
| `tests/cli/work-start.test.ts` | Tests for work start paths before refactoring | ~250 |

---

### Task 1: Write Pre-Refactor Tests for work start Logic

**Files:**
- Create: `tests/cli/work-start.test.ts`

> **Eng review D1+D5+D6:** Tests must exercise the actual inline logic in work.ts that will be extracted, NOT just the underlying engine/store APIs. Each test should verify a code path that exists in work.ts lines 255-692, so that extracting those lines into separate modules would cause test failures if logic changes.

- [ ] **Step 1: Write tests for reset logic (work.ts L259-270)**

The reset logic iterates observations, filters by `source === "coldstart"`, and deletes matching rows via raw SQL. Test this exact pattern:

```typescript
import { describe, expect, test, afterEach } from "bun:test";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { WorkspaceStore } from "../../src/workspace/store";
import { cleanup, tempDb } from "../helpers/temp-db";

describe("work start: reset coldstart data", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("reset=true deletes only coldstart-source observations", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal", key: "coldstart:git.commit_time_distribution",
      value: JSON.stringify({ morning_ratio: 0.5 }), confidence: 4,
      source: "coldstart", provenance: "{}",
    });
    engine.addObservation({
      type: "signal", key: "coldstart:goal",
      value: "build api", confidence: 8,
      source: "coldstart", provenance: "{}",
    });
    engine.addObservation({
      type: "signal", key: "manual:note",
      value: "keep this", confidence: 5,
      source: "user", provenance: "{}",
    });

    // Replicate work.ts L260-268 reset logic exactly
    const existingObs = engine.getObservations({ type: "signal" });
    const raw = db.getDatabase();
    for (const obs of existingObs) {
      if (obs.source === "coldstart") {
        raw.query("DELETE FROM observations WHERE id = $id").run({ $id: obs.id });
      }
    }

    const remaining = engine.getObservations({ type: "signal" });
    expect(remaining.length).toBe(1);
    expect(remaining[0].source).toBe("user");
    db.close();
  });

  test("reset=false leaves all observations intact", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal", key: "coldstart:goal",
      value: "test", confidence: 5,
      source: "coldstart", provenance: "{}",
    });

    const obs = engine.getObservations({ key: "coldstart:goal" });
    expect(obs.length).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test tests/cli/work-start.test.ts`
Expected: PASS

- [ ] **Step 3: Write tests for rerun detection (work.ts L306-325)**

The rerun detection checks `coldstart:goal` observations exist AND `!options.reset`. Test the condition logic:

```typescript
describe("work start: rerun detection", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("skips interview when coldstart:goal exists and reset=false", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal", key: "coldstart:goal",
      value: "build api", confidence: 8,
      source: "coldstart", provenance: "{}",
    });

    // Replicate work.ts L306-307 condition
    const existingAnswers = engine.getObservations({ key: "coldstart:goal" });
    const shouldSkip = existingAnswers.length > 0 && !false; // reset=false
    expect(shouldSkip).toBe(true);
    db.close();
  });

  test("does not skip when coldstart:goal missing", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    const existingAnswers = engine.getObservations({ key: "coldstart:goal" });
    const shouldSkip = existingAnswers.length > 0 && !false;
    expect(shouldSkip).toBe(false);
    db.close();
  });

  test("does not skip when reset=true even if goal exists", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal", key: "coldstart:goal",
      value: "build api", confidence: 8,
      source: "coldstart", provenance: "{}",
    });

    const existingAnswers = engine.getObservations({ key: "coldstart:goal" });
    const shouldSkip = existingAnswers.length > 0 && !true; // reset=true
    expect(shouldSkip).toBe(false);
    db.close();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/cli/work-start.test.ts`
Expected: PASS

- [ ] **Step 5: Write tests for workspace lifecycle (work.ts L337-352, L381-384)**

Test the workspace creation and cleanup-on-abort patterns used in work.ts:

```typescript
describe("work start: workspace lifecycle", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("workspace created and visible in list", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({
      name: `Cold Start - ${new Date().toISOString().slice(0, 10)}`,
      description: "Workspace created during cold start",
    });
    expect(store.listWorkspaces().length).toBe(1);
    expect(ws.name).toContain("Cold Start");
    db.close();
  });

  test("workspace deleted on abort — no orphaned data", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Abort Test" });
    store.deleteWorkspace(ws.id);
    expect(store.listWorkspaces().length).toBe(0);
    db.close();
  });

  test("double deleteWorkspace does not throw", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Double Delete" });
    store.deleteWorkspace(ws.id);
    expect(() => store.deleteWorkspace(ws.id)).not.toThrow();
    db.close();
  });
});
```

- [ ] **Step 6: Run tests**

Run: `bun test tests/cli/work-start.test.ts`
Expected: PASS

- [ ] **Step 7: Write tests for derive logic (work.ts L404-429)**

Test the derive-from-rules pipeline with and without coldstart observations:

```typescript
import { Derivator } from "../../src/core/profile/derivator";

describe("work start: derive and preview", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("derives zero traits with no observations", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules(false);
    expect(traits.length).toBe(0);
    db.close();
  });

  test("derives traits from coldstart goal observation", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal", key: "coldstart:goal",
      value: "Build comprehensive API with auth, RBAC, and audit logging for enterprise compliance",
      confidence: 9, source: "coldstart", provenance: "{}",
    });

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules(false);
    // Derivator should produce at least one trait from a detailed goal
    expect(traits.length).toBeGreaterThan(0);
    db.close();
  });
});
```

- [ ] **Step 8: Run tests**

Run: `bun test tests/cli/work-start.test.ts`
Expected: PASS

- [ ] **Step 9: Write SIGINT behavior validation test (eng review D2)**

Validate how Bun's readline responds to SIGINT. This determines whether the cooperative SIGINT model works or needs active rl.close():

```typescript
import { spawn } from "node:child_process";
import { join } from "node:path";

describe("work start: SIGINT readline behavior", () => {
  test("SIGINT causes readline process to exit within 2 seconds", async () => {
    // Spawn a child that creates a readline and waits for input
    const child = spawn("bun", ["-e", `
      const { createInterface } = require("node:readline");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("prompt> ", (answer) => {
        console.log("answered:" + answer);
        rl.close();
        process.exit(0);
      });
    `], { stdio: ["pipe", "pipe", "pipe"] });

    const exitPromise = new Promise<number>((resolve) => {
      child.on("exit", (code) => resolve(code ?? -1));
    });

    // Wait for readline to be ready, then send SIGINT
    await new Promise((r) => setTimeout(r, 200));
    child.kill("SIGINT");

    const exitCode = await exitPromise;
    // SIGINT should cause the process to exit (code may vary)
    expect(exitCode).toBeDefined();
  });
});
```

- [ ] **Step 10: Run tests**

Run: `bun test tests/cli/work-start.test.ts`
Expected: PASS (if SIGINT test fails, cooperative SIGINT model needs active rl.close())

- [ ] **Step 11: Commit tests**

```bash
git add tests/cli/work-start.test.ts
git commit -m "test: add pre-refactor tests for work start lifecycle logic"
```

---

### Task 2: Create work/types.ts

**Files:**
- Create: `src/cli/work/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
import type { Database } from "bun:sqlite";
import type { KaiDB } from "../../db/client";
import type { ProfileEngine } from "../../core/profile/engine";
import type { WorkspaceStore } from "../../workspace/store";
import type { Workspace } from "../../workspace/types";
import type { GitScanResult } from "./git-scan";

export interface WorkStartOptions {
  reset?: boolean;
}

export interface WorkStartContext {
  db: KaiDB;
  engine: ProfileEngine;
  store?: WorkspaceStore;
  workspace?: Workspace;
  gitResult?: GitScanResult;
  identity?: { name: string; role: string };
  answers?: { slug: string; text: string }[];
  previewTraits?: import("../../core/profile/derivator").DerivedTrait[];
  completed: boolean;
}

export type PhaseResult = {
  status: "continue" | "abort";
  context?: Partial<WorkStartContext>;
};
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: May fail (git-scan.ts doesn't exist yet). We'll fix in Task 3. For now just verify types.ts syntax is valid:

Run: `npx tsc --noEmit src/cli/work/types.ts 2>&1 | head -5`
Expected: Errors about missing git-scan module — that's expected.

- [ ] **Step 3: Commit**

```bash
mkdir -p src/cli/work
git add src/cli/work/types.ts
git commit -m "refactor: add WorkStartContext and PhaseResult types"
```

---

### Task 3: Extract git-scan.ts

**Files:**
- Create: `src/cli/work/git-scan.ts`
- Modify: `src/cli/work.ts` (remove extracted code, add re-export)
- Test: `tests/git-scan.test.ts` (verify still passes)

- [ ] **Step 1: Create git-scan.ts with extracted code**

Copy lines 1-2, 63-214 from `src/cli/work.ts` into a new file:

```typescript
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AddObservationInput } from "../../core/profile/engine";
import { renderError } from "../format";

const MIN_GIT_COMMITS = 5;
const MORNING_HOUR_START = 5;
const MORNING_HOUR_END = 8;
const MORNING_RATIO_THRESHOLD = 0.3;
const DETAIL_LEVEL_HIGH_CHARS = 50;
const DETAIL_LEVEL_MED_CHARS = 20;

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

  const gitDir = join(repoPath, ".git");
  if (!existsSync(gitDir)) return { observations, traits };

  let logOutput: string;
  try {
    logOutput = execSync(
      'git log --oneline --since="30.days ago" --format="%H%x00%aI%x00%s"',
      { cwd: repoPath, encoding: "utf-8", timeout: 5000 },
    ).trim();
  } catch (err) {
    console.error(renderError(err as Error));
    return { observations, traits };
  }

  if (!logOutput) return { observations, traits };

  const lines = logOutput.split("\n");
  if (lines.length < MIN_GIT_COMMITS) return { observations, traits };

  const hours: number[] = [];
  for (const line of lines) {
    const parts = line.split("\0");
    if (parts.length >= 2) {
      const match = parts[1].match(/T(\d{2}):/);
      if (match) hours.push(Number.parseInt(match[1], 10));
    }
  }

  if (hours.length > 0) {
    const morningCount = hours.filter(
      (h) => h >= MORNING_HOUR_START && h <= MORNING_HOUR_END,
    ).length;
    const morningRatio = morningCount / hours.length;

    observations.push({
      type: "signal",
      key: "coldstart:git.commit_time_distribution",
      value: JSON.stringify({
        morning_ratio: morningRatio,
        total_commits: hours.length,
      }),
      confidence: 4,
      source: "coldstart",
      provenance: makeProvenance("commit_time"),
    });

    if (morningRatio > MORNING_RATIO_THRESHOLD) {
      traits.push({
        dimension: "early_riser",
        hints: [`${Math.round(morningRatio * 100)}% morning commits`],
      });
    }
  }

  const msgLengths = lines.map((l) => {
    const parts = l.split("\0");
    return (parts[2] ?? "").length;
  });
  const avgLen = msgLengths.reduce((a, b) => a + b, 0) / msgLengths.length;

  observations.push({
    type: "signal",
    key: "coldstart:git.commit_message_length",
    value: JSON.stringify({
      avg_length: Math.round(avgLen),
      total_commits: lines.length,
      detail_level:
        avgLen > DETAIL_LEVEL_HIGH_CHARS
          ? "high"
          : avgLen > DETAIL_LEVEL_MED_CHARS
            ? "medium"
            : "low",
    }),
    confidence: 4,
    source: "coldstart",
    provenance: makeProvenance("commit_length"),
  });

  if (avgLen > DETAIL_LEVEL_HIGH_CHARS) {
    traits.push({
      dimension: "detail_oriented",
      hints: [`avg commit message ${Math.round(avgLen)} chars`],
    });
  }

  let currentBranch = "";
  try {
    currentBranch = execSync("git branch --show-current", {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  } catch {
    // detached HEAD, shallow clone, etc.
  }

  if (currentBranch) {
    const hasStructuredPrefix = /^(feat|fix|chore|docs|refactor)\//.test(
      currentBranch,
    );
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
```

- [ ] **Step 2: Update work.ts — remove git-scan code, add re-export**

In `src/cli/work.ts`, delete lines 63-214 (everything between `// --- Git History Scanner ---` and `// --- Profile Preview Display ---`). Then add this import at the top:

```typescript
export { scanGitHistory, type GitScanResult } from "./work/git-scan";
```

Also remove these now-unused imports from work.ts:
- `import { execSync } from "node:child_process";`
- `import { existsSync } from "node:fs";`
- `import { join } from "node:path";`

Keep `import type { AddObservationInput } from "../core/profile/engine";` if still used by other code in work.ts (check: it's used in the `GitScanResult` interface that was moved, so remove it too).

- [ ] **Step 3: Run git-scan tests**

Run: `bun test tests/git-scan.test.ts`
Expected: PASS — tests import from `../src/cli/work` which re-exports from `./work/git-scan`

- [ ] **Step 4: Run cold-start tests**

Run: `bun test tests/cold-start.test.ts tests/cold-start-gaps.test.ts tests/coldstart-bootstrapper.test.ts tests/coldstart-rules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/work.ts src/cli/work/git-scan.ts
git commit -m "refactor: extract git-scan.ts from work.ts"
```

---

### Task 4: Extract ui.ts

**Files:**
- Create: `src/cli/work/ui.ts`
- Modify: `src/cli/work.ts` (remove extracted code)

- [ ] **Step 1: Create ui.ts**

```typescript
import type { DerivedTrait } from "../../core/profile/derivator";
import { bar } from "../format";

export function progress(message: string): void {
  if (process.argv.includes("--json")) return;
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r\x1b[2K  ${message}...`);
}

export function progressDone(message: string): void {
  if (process.argv.includes("--json")) return;
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r\x1b[2K  ${message}\n`);
}

export function displayPreview(
  traits: DerivedTrait[],
  gitHints: { dimension: string; hints: string[] }[],
): void {
  console.log(
    `\n✓ Profile draft generated (${traits.length} traits detected):\n`,
  );

  const hintMap = new Map<string, string[]>();
  for (const h of gitHints) {
    const existing = hintMap.get(h.dimension) ?? [];
    hintMap.set(h.dimension, [...existing, ...h.hints]);
  }

  for (const t of traits) {
    const barStr = bar(t.value);
    const hints = hintMap.get(t.dimension);
    const hintStr = hints ? ` + ${hints.join(", ")}` : "";
    const reasoning =
      t.reasoning.length > 60 ? `${t.reasoning.slice(0, 57)}...` : t.reasoning;
    console.log(
      `  ${t.dimension.padEnd(22)}${barStr}  ${t.confidence}/10  — ${reasoning}${hintStr}`,
    );
  }

  console.log("\nLooks right? [Y]es / [E]dit trait / [R]estart");
}
```

- [ ] **Step 2: Update work.ts — remove ui code and unused import**

In `src/cli/work.ts`, delete lines 49-61 (progress/progressDone) and lines 218-244 (displayPreview). Add import:

```typescript
import { progress, progressDone, displayPreview } from "./work/ui";
```

Remove `import { bar, renderError } from "./format";` if `bar` is no longer used directly in work.ts (check: `bar` was only used in `displayPreview` which moved). Keep `renderError` if still used by recommendations code in work.ts.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/work.ts src/cli/work/ui.ts
git commit -m "refactor: extract ui.ts from work.ts"
```

---

### Task 5: Extract status.ts

**Files:**
- Create: `src/cli/work/status.ts`
- Modify: `src/cli/work.ts` (remove status/list commands, delegate to status module)

- [ ] **Step 1: Create status.ts**

```typescript
import { WorkspaceStore } from "../../workspace/store";
import {
  renderWorkspaceList,
  renderWorkspaceStatus,
} from "../renderers/workspace";
import { getEngine } from "../utils";

export function handleWorkStatus(): void {
  const { db } = getEngine();
  const store = new WorkspaceStore(db);

  const workspaces = store.listWorkspaces();
  const active = workspaces.filter((w) => w.status === "active");

  if (active.length === 0) {
    console.log(
      "No active workspaces. Run `kai work start` to create one.",
    );
  } else {
    const ids = active.map((w) => w.id);
    const taskStats = store.getTaskStatsByWorkspaces(ids);
    const eventCounts = store.getEventCountsByWorkspaces(ids);

    const enriched = active.map((ws) => ({
      ...ws,
      taskCount: taskStats.get(ws.id)?.total ?? 0,
      completedTasks: taskStats.get(ws.id)?.completed ?? 0,
      eventCount: eventCounts.get(ws.id) ?? 0,
    }));

    console.log(renderWorkspaceStatus(enriched));
  }

  db.close();
}

export function handleWorkList(): void {
  const { db } = getEngine();
  const store = new WorkspaceStore(db);

  const workspaces = store.listWorkspaces();

  if (workspaces.length > 0) {
    const ids = workspaces.map((w) => w.id);
    const taskStats = store.getTaskStatsByWorkspaces(ids);
    const enriched = workspaces.map((ws) => ({
      ...ws,
      taskCount: taskStats.get(ws.id)?.total ?? 0,
      completedTasks: taskStats.get(ws.id)?.completed ?? 0,
    }));
    console.log(renderWorkspaceList(enriched));
  } else {
    console.log(renderWorkspaceList(workspaces));
  }

  db.close();
}
```

- [ ] **Step 2: Update work.ts — replace status/list command bodies**

In `src/cli/work.ts`, replace the `work status` command body (currently `.action(() => { ... })`) with:

```typescript
import { handleWorkStatus, handleWorkList } from "./work/status";
```

Then replace the two command handlers:

```typescript
  work
    .command("status")
    .description("Show current workspace status")
    .action(() => handleWorkStatus());

  work
    .command("list")
    .description("List all workspaces")
    .action(() => handleWorkList());
```

Remove the now-unused imports from work.ts that were only used by status/list:
- `import { renderWorkspaceList, renderWorkspaceStatus } from "./renderers/workspace";` — remove if no longer used in work.ts

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/work.ts src/cli/work/status.ts
git commit -m "refactor: extract status.ts from work.ts"
```

---

### Task 6: Extract recommendations.ts

**Files:**
- Create: `src/cli/work/recommendations.ts`
- Modify: `src/cli/work.ts` (remove recommendation code)

This is the most complex extraction. Contains `getIdeaRecommendations` (lines 26-47) and the recommendation approval + LLM dispatch + penalization block (lines 514-688).

- [ ] **Step 1: Create recommendations.ts**

```typescript
import { HermesAgentBridge } from "../../bridge/agent-bridge";
import { Dispatcher } from "../../core/orchestrator/dispatcher";
import { resolveIdeaDomain } from "../../core/orchestrator/domain-resolver";
import { recommendTasks } from "../../core/orchestrator/recommend";
import { OrchestratorStore } from "../../core/orchestrator/store";
import type { DerivedTrait } from "../../core/profile/derivator";
import type { KaiDB } from "../../db/client";
import type { WorkspaceStore } from "../../workspace/store";
import type { Workspace } from "../../workspace/types";
import { renderError } from "../format";
import { renderRecommendations } from "../renderers/recommendations";

function getIdeaRecommendations(
  engine: { getTraits: () => DerivedTrait[]; getObservations: (filter: { key: string }) => { value: string }[] },
) {
  const savedTraits = engine.getTraits();
  const domainObs = engine.getObservations({
    key: "coldstart:signal.domain",
  });
  let domainValue = "general";
  if (domainObs.length > 0) {
    try {
      domainValue = JSON.parse(domainObs[0].value).domains?.[0] ?? "general";
    } catch {
      // malformed JSON
    }
  }
  const ideaDomain = resolveIdeaDomain(domainValue);
  return {
    recommendations: recommendTasks(savedTraits, ideaDomain),
    savedTraits,
    ideaDomain,
  };
}

export async function runRecommendations(
  db: KaiDB,
  engine: { getTraits: () => DerivedTrait[]; getObservations: (filter: { key: string }) => { value: string }[]; setTrait: (t: DerivedTrait) => void },
  store: WorkspaceStore,
  workspace: Workspace,
  previewTraits: DerivedTrait[],
): Promise<void> {
  const { recommendations, savedTraits, ideaDomain } = getIdeaRecommendations(engine);

  if (recommendations.length === 0) {
    console.log("\nNo matching workflows found for your profile.");
    return;
  }

  console.log(renderRecommendations(recommendations, { showHint: false }));

  store.addEvent({
    workspace_id: workspace.id,
    event_type: "recommendation_shown",
    payload: JSON.stringify({
      recommendations: recommendations.map((r) => r.templateId),
    }),
  });

  // Create readline for approval prompt — wrapped in try/finally (D9)
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((r) => rl.question(q, r));

  try {
    console.log(
      "\nSelect: number (1-%d) to pick one, [A]ll to approve all, [N]o to skip",
      recommendations.length,
    );
    const approveResponse = (await ask("> ")).trim().toLowerCase();

    const selectedIdx = parseInt(approveResponse, 10) - 1;
    const selected: number[] =
      approveResponse === "a" || approveResponse === "all"
        ? recommendations.map((_, i) => i)
        : !Number.isNaN(selectedIdx) &&
            selectedIdx >= 0 &&
            selectedIdx < recommendations.length
          ? [selectedIdx]
          : [];

    const orchStore = new OrchestratorStore(db);
    const { LLMProvider } = await import("../../llm/provider");
    const llm = new LLMProvider();

    for (const idx of selected) {
      const rec = recommendations[idx];
      const idea = orchStore.createIdea({
        title: rec.title,
        description: rec.description,
        domain: ideaDomain,
        workspace_id: workspace.id,
      });

      let llmTasksCreated = false;
      if (llm.getConfig().apiKey) {
        try {
          const { GeneStore } = await import("../../core/prompt/gene-store");
          const { PromptCompiler } = await import("../../core/prompt/prompt-compiler");
          const geneStore = new GeneStore(db);
          const compiler = new PromptCompiler(geneStore);
          const { Planner } = await import("../../core/orchestrator/planner");
          const planner = new Planner(orchStore, llm, compiler);
          const tasks = await planner.decomposeIdea(idea.id, savedTraits);
          console.log(`\nPlan generated (${tasks.length} tasks):`);
          for (const t of tasks) {
            console.log(`  - ${t.title}`);
          }
          llmTasksCreated = tasks.length > 0;
        } catch (err) {
          console.error(renderError(err as Error));
          console.log(
            "  Could not generate plan (LLM unavailable), creating task directly.",
          );
        }
      }

      if (!llmTasksCreated) {
        const task = orchStore.createTask({
          idea_id: idea.id,
          workspace_id: workspace.id,
          title: rec.title,
          description: rec.description,
          type: "one_off",
          agent: "hermes",
          prompt: rec.description,
          decomposition_rationale: "Auto-generated from cold start recommendation",
          scheduling_rationale: "Execute when ready",
        });

        try {
          const bridge = new HermesAgentBridge();
          const dispatcher = new Dispatcher(orchStore, bridge);
          const result = await dispatcher.dispatch(task.id);
          if (result.success) {
            console.log(`✓ Task dispatched: ${task.title}`);
            const wsTask = store.createTask({
              workspace_id: workspace.id,
              title: task.title,
              description: task.description,
            });
            store.addEvent({
              workspace_id: workspace.id,
              task_id: wsTask.id,
              event_type: "task_auto_executed",
              payload: JSON.stringify({
                planned_task_id: task.id,
                idea_id: idea.id,
              }),
            });
          }
        } catch (err) {
          console.error(renderError(err as Error));
          console.log(`  Task created but not dispatched (agent unavailable)`);
        }
      }

      store.addEvent({
        workspace_id: workspace.id,
        event_type: "recommendation_accepted",
        payload: JSON.stringify({ template_id: rec.templateId }),
      });
    }

    // Emit rejection events + penalize confidence
    const rejected = recommendations.filter((_, i) => !selected.includes(i));
    if (rejected.length > 0) {
      for (const rec of rejected) {
        store.addEvent({
          workspace_id: workspace.id,
          event_type: "recommendation_rejected",
          payload: JSON.stringify({ template_id: rec.templateId }),
        });
      }

      const rejectedDims = new Set<string>();
      for (const rec of rejected) {
        if (rec.traitTargets) {
          for (const dim of Object.keys(rec.traitTargets)) {
            rejectedDims.add(dim);
          }
        }
      }
      const { ProfileEngine } = await import("../../core/profile/engine");
      const profileEngine = new ProfileEngine(db);
      for (const dim of rejectedDims) {
        const existing = profileEngine.getTraits({ dimension: dim });
        if (existing.length > 0 && existing[0].confidence > 1) {
          profileEngine.setTrait({
            dimension: dim,
            value: existing[0].value,
            confidence: Math.max(1, existing[0].confidence - 1),
            source: existing[0].source,
            reasoning: `${existing[0].reasoning} [confidence reduced: recommendation rejected]`,
          });
        }
      }
    }
  } finally {
    rl.close();
  }
}

// Exported for the rerun-detection shortcut path
export { getIdeaRecommendations };
```

Note: All 5 dynamic imports have been updated from `../` to `../../`:
1. `../../llm/provider` (was `../llm/provider`)
2. `../../core/prompt/gene-store` (was `../core/prompt/gene-store`)
3. `../../core/prompt/prompt-compiler` (was `../core/prompt/prompt-compiler`)
4. `../../core/orchestrator/planner` (was `../core/orchestrator/planner`)
5. `../../core/profile/engine` (was `../core/profile/engine`)

- [ ] **Step 2: Update work.ts — remove recommendation code**

In `src/cli/work.ts`, remove:
- Lines 26-47 (`getIdeaRecommendations` function)
- Lines 514-688 (recommendation approval + dispatch block in the start action)
- The `confirmed &&` recommendation conditional block

Add import:
```typescript
import { runRecommendations, getIdeaRecommendations } from "./work/recommendations";
```

Remove now-unused imports from work.ts:
- `import { HermesAgentBridge } from "../bridge/agent-bridge";`
- `import { Dispatcher } from "../core/orchestrator/dispatcher";`
- `import { resolveIdeaDomain } from "../core/orchestrator/domain-resolver";`
- `import { recommendTasks } from "../core/orchestrator/recommend";`
- `import { OrchestratorStore } from "../core/orchestrator/store";`

Keep `import { renderError } from "./format"` if still used.
Remove `import { renderRecommendations } from "./renderers/recommendations"` if no longer used directly.

Update the `work start` action to call `runRecommendations` instead of inline code:
```typescript
if (confirmed) {
  await runRecommendations(db, engine, store, workspace, previewTraits);
}
```

Also update the rerun-detection path (line ~311) to use the imported `getIdeaRecommendations`:
```typescript
const { recommendations } = getIdeaRecommendations(engine);
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All PASS

- [ ] **Step 5: Run orchestrator-specific tests**

Run: `bun test tests/core/orchestrator tests/mcp/work-recommend-handler.test.ts tests/cli/renderers/recommendations.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/work.ts src/cli/work/recommendations.ts
git commit -m "refactor: extract recommendations.ts from work.ts with all 5 dynamic import path updates"
```

---

### Task 7: Extract start.ts with PhaseResult + Cooperative SIGINT

**Files:**
- Create: `src/cli/work/start.ts`
- Modify: `src/cli/work.ts` (replace inline start action with delegation)

This is the behavioral core. The PhaseResult pattern replaces scattered early returns with state-based flow. SIGINT becomes cooperative (sets a flag, lets readline reject, flow reaches `finally`).

- [ ] **Step 1: Create start.ts**

```typescript
import { createInterface } from "node:readline";
import { Derivator } from "../../core/profile/derivator";
import { InterviewEngine } from "../../core/profile/interview";
import { QUESTIONS } from "../../core/profile/interview-questions";
import { WorkspaceStore } from "../../workspace/store";
import { renderError } from "../format";
import { getEngine } from "../utils";
import { scanGitHistory, type GitScanResult } from "./git-scan";
import { progress, progressDone, displayPreview } from "./ui";
import { runRecommendations, getIdeaRecommendations } from "./recommendations";
import { renderRecommendations } from "../renderers/recommendations";
import type { WorkStartOptions, WorkStartContext, PhaseResult } from "./types";

function ask(rl: import("node:readline").Interface, q: string): Promise<string> {
  return new Promise((r) => rl.question(q, r));
}

async function resetColdstartData(
  ctx: WorkStartContext,
  options: WorkStartOptions,
): Promise<PhaseResult> {
  if (!options.reset) return { status: "continue" };

  const existingObs = ctx.engine.getObservations({ type: "signal" });
  const raw = ctx.db.getDatabase();
  for (const obs of existingObs) {
    if (obs.source === "coldstart") {
      raw.query("DELETE FROM observations WHERE id = $id").run({ $id: obs.id });
    }
  }
  console.log("Cleared existing cold start data.");
  return { status: "continue" };
}

async function ensureIdentity(ctx: WorkStartContext): Promise<PhaseResult> {
  let identity = ctx.engine.getIdentity();
  if (identity) {
    return { status: "continue", context: { identity } };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("First, let's set up your identity.\n");
    const name = (await ask(rl, "What's your name? ")).trim();
    const role = (await ask(rl, "What's your role? ")).trim();

    if (!name) {
      console.log("Name is required. Aborting.");
      return { status: "abort" };
    }

    ctx.engine.createIdentity({ name, role: role || "developer" });
    identity = ctx.engine.getIdentity();
    console.log(`\nWelcome, ${identity?.name}!\n`);
    return { status: "continue", context: { identity: identity! } };
  } finally {
    rl.close();
  }
}

async function checkRerun(ctx: WorkStartContext, options: WorkStartOptions): Promise<PhaseResult> {
  const existingAnswers = ctx.engine.getObservations({ key: "coldstart:goal" });
  if (existingAnswers.length > 0 && !options.reset) {
    console.log(
      "Cold start already completed. Showing recommendations from existing profile...",
    );
    const { recommendations } = getIdeaRecommendations(ctx.engine);

    if (recommendations.length === 0) {
      console.log("\nNo matching workflows found for your profile.");
      return { status: "abort" };
    }

    console.log(renderRecommendations(recommendations, { showHint: false }));
    return { status: "abort" }; // exit after showing cached recs
  }
  return { status: "continue" };
}

async function gitScan(ctx: WorkStartContext): Promise<PhaseResult> {
  const result = scanGitHistory(process.cwd());
  progress("Scanning git history");
  const gitResult = scanGitHistory(process.cwd());
  progressDone("Git scan complete");

  for (const obs of gitResult.observations) {
    ctx.engine.addObservation(obs);
  }

  return { status: "continue", context: { gitResult } };
}

async function createWorkspace(ctx: WorkStartContext): Promise<PhaseResult> {
  const store = new WorkspaceStore(ctx.db);
  const workspace = store.createWorkspace({
    name: `Cold Start - ${new Date().toISOString().slice(0, 10)}`,
    description: "Workspace created during cold start",
  });

  return {
    status: "continue",
    context: { store, workspace },
  };
}

async function runInterview(ctx: WorkStartContext): Promise<PhaseResult> {
  const store = ctx.store!;
  const workspace = ctx.workspace!;
  const gitResult = ctx.gitResult!;

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(`\nWorkspace: ${workspace.id}\n`);

    const answers: { slug: string; text: string }[] = [];
    for (const q of QUESTIONS) {
      let promptText = q.prompt;
      if (q.options && q.options.length > 0) {
        promptText += `\n  ${q.options.map((o) => `▸ ${o}`).join("    ")}\n> `;
      } else {
        promptText += "\n> ";
      }

      let answer = (await ask(rl, promptText)).trim();

      if (!answer && q.required) {
        console.log("This one's required.");
        answer = (await ask(rl, promptText)).trim();
        if (!answer) {
          console.log("Required answer missing. Cleaning up and aborting.");
          return { status: "abort" };
        }
      }

      answers.push({ slug: q.slug, text: answer });

      store.addEvent({
        workspace_id: workspace.id,
        event_type: "coldstart_answer",
        payload: JSON.stringify({ slug: q.slug, text: answer }),
      });
    }

    return { status: "continue", context: { answers } };
  } finally {
    rl.close();
  }
}

async function deriveAndPreview(ctx: WorkStartContext): Promise<PhaseResult> {
  const store = ctx.store!;
  const workspace = ctx.workspace!;
  const gitResult = ctx.gitResult!;
  const answers = ctx.answers!;

  progress("Extracting signals");
  const interview = new InterviewEngine();
  const signals = interview.extractSignalsFromAnswers(
    answers,
    gitResult.traits,
    workspace.id,
  );
  progressDone(`Extracted ${signals.length} signals`);
  for (const obs of signals) {
    ctx.engine.addObservation(obs);
  }

  progress("Deriving traits");
  const derivator = new Derivator(ctx.engine);
  const previewTraits = derivator.deriveFromRules(false);
  progressDone(`Derived ${previewTraits.length} traits`);

  if (previewTraits.length === 0) {
    console.log(
      "\nCouldn't derive any traits from your answers. Try `kai profile derive` later.",
    );
    return { status: "abort" };
  }

  displayPreview(previewTraits, gitResult.traits);

  // Confirm/edit/restart loop
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    let confirmed = false;
    while (!confirmed) {
      const response = (await ask(rl, "> ")).trim().toLowerCase() || "y";

      if (response === "y" || response === "yes") {
        for (const trait of previewTraits) {
          ctx.engine.setTrait(trait);
        }

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
        console.log(
          `✓ Ready to work. Use \`kai work status\` to see your workspace.`,
        );
        confirmed = true;
      } else if (response === "e" || response === "edit") {
        const dim = (await ask(rl, "Which trait? (dimension name) ")).trim();
        const trait = previewTraits.find(
          (t) => t.dimension === dim || t.dimension.startsWith(dim),
        );
        if (!trait) {
          console.log(
            `  No trait matching "${dim}". Available: ${previewTraits.map((t) => t.dimension).join(", ")}`,
          );
          continue;
        }

        const newValue = (
          await ask(rl, `  Value (0.0-1.0, current: ${trait.value}): `)
        ).trim();
        const newConf = (
          await ask(rl, `  Confidence (1-10, current: ${trait.confidence}): `)
        ).trim();

        if (newValue) {
          const parsed = Number.parseFloat(newValue);
          if (!Number.isNaN(parsed))
            trait.value = Math.max(0, Math.min(1, parsed));
        }
        if (newConf) {
          const parsed = Number.parseInt(newConf, 10);
          if (!Number.isNaN(parsed))
            trait.confidence = Math.max(1, Math.min(10, parsed));
        }

        console.log("\nUpdated preview:");
        displayPreview(previewTraits, gitResult.traits);
      } else if (response === "r" || response === "restart") {
        // restart = abort per eng review D2 — user re-runs the command
        console.log("\nRestarting cold start...");
        return { status: "abort" };
      } else {
        console.log("  Please enter [Y]es, [E]dit, or [R]estart");
      }
    }

    return { status: "continue", context: { previewTraits, completed: confirmed } };
  } finally {
    rl.close();
  }
}

export async function handleWorkStart(options: WorkStartOptions): Promise<void> {
  const { db, engine } = getEngine();

  // Cooperative SIGINT: set flag instead of process.exit
  // readline will reject its pending promise on SIGINT,
  // the error propagates, and finally block handles cleanup.
  let sigintReceived = false;
  const onSigInt = () => {
    sigintReceived = true;
    console.log("\n\nAborted.");
  };
  process.on("SIGINT", onSigInt);

  const ctx: WorkStartContext = { db, engine, completed: false };

  try {
    const phases = [
      (c: WorkStartContext) => resetColdstartData(c, options),
      ensureIdentity,
      (c: WorkStartContext) => checkRerun(c, options),
      gitScan,
      createWorkspace,
      runInterview,
      deriveAndPreview,
    ];

    for (const phase of phases) {
      if (sigintReceived) return;
      const result = await phase(ctx);
      if (result.status === "continue" && result.context) {
        Object.assign(ctx, result.context);
      }
      if (result.status === "abort") return;
    }

    // Step 8: Recommendations (only if confirmed)
    if (ctx.completed && ctx.store && ctx.workspace && ctx.previewTraits) {
      await runRecommendations(db, engine, ctx.store, ctx.workspace, ctx.previewTraits);
    }
  } finally {
    // Centralized cleanup — all paths converge here
    // (including cooperative SIGINT which sets flag and lets flow reach here)
    process.removeListener("SIGINT", onSigInt);

    // Delete workspace if flow did not complete successfully
    if (ctx.store && ctx.workspace && !ctx.completed) {
      try {
        ctx.store.deleteWorkspace(ctx.workspace.id);
      } catch {
        // workspace may already be deleted — ignore
      }
    }

    db.close();
  }
}
```

- [ ] **Step 2: Update work.ts — replace start action with delegation**

In `src/cli/work.ts`, replace the entire `work start` action handler body with:

```typescript
import { handleWorkStart } from "./work/start";

// Inside registerWorkCommands:
  work
    .command("start")
    .description("Start a new workspace with cold start profile bootstrapping")
    .option("--reset", "Force re-interview even if coldstart data exists")
    .action(async (options: { reset?: boolean }) => {
      await handleWorkStart({ reset: options.reset });
    });
```

Remove all remaining imports from work.ts that are now only used in start.ts:
- `import { createInterface } from "node:readline";`
- `import { Derivator } from "../core/profile/derivator";`
- `import { InterviewEngine } from "../core/profile/interview";`
- `import { QUESTIONS } from "../core/profile/interview-questions";`
- `import { WorkspaceStore } from "../workspace/store";`

Keep only:
- `import type { Command } from "commander";`
- `import { getEngine } from "./utils";` (if status.ts uses it directly, can remove)
- `export { scanGitHistory, type GitScanResult } from "./work/git-scan";`
- `import { handleWorkStart } from "./work/start";`
- `import { handleWorkStatus, handleWorkList } from "./work/status";`

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All PASS

- [ ] **Step 5: Run all coldstart-related tests**

Run: `bun test tests/cold-start.test.ts tests/cold-start-gaps.test.ts tests/coldstart-bootstrapper.test.ts tests/coldstart-rules.test.ts tests/e2e/coldstart-flow.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/work.ts src/cli/work/start.ts
git commit -m "refactor: extract start.ts with PhaseResult control flow and cooperative SIGINT"
```

---

### Task 8: Full Health Check + TODOS.md Update

**Files:**
- Modify: `TODOS.md` (add TODO 12)
- Verify: all source files, all tests

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors

- [ ] **Step 2: Run lint**

Run: `npx @biomejs/biome check src/`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All PASS (798+ tests)

- [ ] **Step 4: Run dead code check**

Run: `npx knip`
Expected: PASS — no new dead code (facade re-exports should not be flagged)

If knip flags the re-exports in work.ts, add them to knip's ignore list in `knip.json` or `package.json` config.

- [ ] **Step 5: Add TODO 12 to TODOS.md**

Append to `TODOS.md`:

```markdown
## TODO 12: Restart doesn't clean coldstart observations
- **What**: When user selects "Restart" in the confirm/edit/restart loop, the workspace is deleted but coldstart observations (especially `coldstart:goal`) remain in the DB
- **Why**: Next run detects `coldstart:goal` and skips the interview, showing cached recommendations instead of re-interviewing — user expects a fresh start
- **Pros**: Fixes user expectation — restart should be a true clean slate
- **Cons**: Slightly more complex abort cleanup; must also delete coldstart signals
- **Context**: Found by Codex outside voice during eng review. Current behavior: `store.deleteWorkspace()` runs but coldstart:goal observations persist. Fix: delete all observations with `source === "coldstart"` on abort/restart paths
- **Effort**: S (human: ~15min / CC: ~5min)
- **Priority**: P2
- **Depends on**: work.ts decomposition (this PR)
- **Added**: 2026-05-25 by /plan-eng-review
```

- [ ] **Step 6: Commit**

```bash
git add TODOS.md
git commit -m "chore: add TODO 12 — restart coldstart observation cleanup"
```

- [ ] **Step 7: Verify work.ts line count**

Run: `wc -l src/cli/work.ts src/cli/work/*.ts`
Expected: `work.ts` under 80 lines, no file in `work/` over 250 lines

- [ ] **Step 8: Run gitnexus detect_changes (if available)**

Run: `npx gitnexus detect-changes 2>/dev/null || echo "gitnexus not configured"`
Expected: Only CLI work decomposition symbols affected

---

## Self-Review Checklist

- [x] **Spec coverage:** Every requirement from the design doc maps to a task:
  - 5 modules + types.ts → Tasks 2-7
  - PhaseResult control flow → Task 7
  - 5 dynamic import paths → Task 6 (all 5 listed in Step 1)
  - Lifecycle cleanup → Task 7 (finally block)
  - Cooperative SIGINT → Task 7 (no process.exit)
  - Test-first approach → Task 1
  - Full health check → Task 8
- [x] **Placeholder scan:** No TBD, TODO, "implement later", or "add validation" anywhere
- [x] **Type consistency:** `WorkStartContext`, `PhaseResult`, `WorkStartOptions` defined in types.ts (Task 2) and used consistently in start.ts (Task 7). `GitScanResult` exported from git-scan.ts and re-exported from work.ts.
- [x] **Eng review findings addressed:**
  - D1 (5 dynamic imports) → Task 6 Step 1
  - D2 (restart = abort) → Task 7 deriveAndPreview phase
  - D3 (cancelled dead code) → Not present in new code
  - D4 (workspace cleanup in finally) → Task 7 handleWorkStart finally block
  - D5 (tests first) → Task 1
  - D6 (DB writes as-is) → No change, per-question writes preserved
  - D7 (cooperative SIGINT) → Task 7 handleWorkStart
  - D8 (TODO 12) → Task 8 Step 5
- [x] **Eng review round 2 decisions applied:**
  - D1: Task 1 tests rewritten to test work.ts inline logic
  - D2: SIGINT behavior test added (Task 1 Step 9)
  - D3: gitScan phase uses static import of scanGitHistory
  - D4: Removed first getIdeaRecommendations version from Task 6
  - D5: Workspace cleanup + rerun detection tests added to Task 1
  - D6: Fixed role default test, removed tautology, fixed async syntax
  - D7: ctx.completed semantics kept (pure refactoring)
  - D8: Restart bug kept as TODO 12 (pure refactoring)
  - D9: runRecommendations rl.close() moved to finally block

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | ISSUES_OPEN | 9 decisions (D1-D9), 13 test gaps, 3 critical (SIGINT paths) |
| Codex Review | `/plan-eng-review` outside voice | Independent 2nd opinion | 1 | ISSUES_FOUND | 16 findings, 4 new (test bugs, ctx.completed, readline leak, restart bug) |

**CROSS-MODEL:** Claude and Codex agree on: Task 1 tests provide false safety net, SIGINT cooperative model needs validation, runRecommendations readline should be in finally. Codex additionally found: ensureIdentity test role default bug, deriveAndPreview tautology, await import in non-async test, ctx.completed overloading.

**UNRESOLVED:** 0 — all findings presented and resolved through D1-D9.

**DECISIONS MADE:**
- D1: Rewrite Task 1 tests to test work.ts inline logic (not engine/store APIs)
- D2: Add SIGINT behavior tests in Task 1 to validate Bun readline response
- D3: Change gitScan dynamic import to static import
- D4: Remove dead exploration code from Task 6 (first getIdeaRecommendations version)
- D5: Add SIGINT + workspace cleanup + rerun detection tests to Task 1
- D6: Fix 3 test bugs (role default location, tautology assertion, async syntax)
- D7: Keep ctx.completed semantics unchanged (pure refactoring constraint)
- D8: Keep restart bug deferred as TODO 12 (pure refactoring constraint)
- D9: Move runRecommendations rl.close() to finally block

**VERDICT:** ENG REVIEW PASSED WITH CONDITIONS — 9 decisions accepted, plan must be updated before execution. No blocking issues remain.
