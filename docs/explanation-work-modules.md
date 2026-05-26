# How the Work Command Modules Work

The `kai work start` command bootstraps a user profile from a 10-question interview and git history scan. Before v0.9.1, this was a 750-line `work.ts` file with scattered early returns, duplicated cleanup code, and a `process.exit(130)` on Ctrl+C that bypassed all finally blocks. The current implementation splits that into 6 focused modules with a phased control flow and cooperative SIGINT cancellation.

## The problem

Three failure modes in the original monolith:

1. **Ctrl+C leaked resources.** `process.exit(130)` killed the process instantly. Pending readline promises never resolved. Workspaces and coldstart observations stayed in the database as orphans. The next `kai work start` would find stale data and show "already completed" instead of starting fresh.

2. **Cleanup was duplicated and incomplete.** SQL `DELETE FROM observations WHERE source = 'coldstart'` appeared in three places, but none of them covered every abort path. The confirm/edit/restart loop's "restart" option deleted the workspace but left coldstart observations behind.

3. **The file was unreadable.** 750 lines of interleaved readline management, interview logic, git scanning, recommendation processing, SIGINT handling, and database cleanup. Adding a new phase meant understanding the whole file.

## The approach: PhaseResult control flow

Each phase of `kai work start` is a separate async function that returns a `PhaseResult`:

```
PhaseResult = { status: "continue" | "abort", context?: Partial<WorkStartContext> }
```

The main orchestrator (`handleWorkStart` in `start.ts`) calls phases sequentially. A `continue` result merges its context into the accumulated state. An `abort` result stops the pipeline and falls through to the centralized `finally` block.

```
Phase 1: resetColdstartData  ──►  Phase 2: ensureIdentity
                                        │
Phase 3: checkRerun  ◄──────────────────┘
      │
Phase 4: gitScan
      │
Phase 5: createWorkspace
      │
      ├── SIGINT handler swaps (delete workspace on Ctrl+C)
      │
Phase 6: runInterview
      │
Phase 7: deriveAndPreview  ◄── confirm/edit/restart loop
      │
Phase 8: runRecommendations
      │
   finally: cleanup (remove listeners, delete workspace + coldstart data if !completed)
```

Every phase checks `sigintReceived` before running. If the user pressed Ctrl+C during a previous phase, the pipeline skips ahead to cleanup.

### Why `PhaseResult` instead of exceptions?

Throwing an exception to abort the pipeline works, but it conflates control flow with error handling. An abort (user chose "restart", or re-run detected) is a normal outcome, not an error. `PhaseResult` makes this explicit: `status: "abort"` is a first-class return value, not a `catch` block.

## The module split

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `types.ts` | 26 | `WorkStartContext`, `WorkStartOptions`, `PhaseResult` type definitions |
| `git-scan.ts` | 158 | `scanGitHistory()` — extracts commit time distribution, message length, branch patterns from the last 30 days of git log |
| `ui.ts` | 47 | `progress()`, `progressDone()`, `displayPreview()` — stderr progress indicators and trait preview rendering |
| `status.ts` | 49 | `handleWorkStatus()`, `handleWorkList()` — workspace listing and status display (separate from the start flow) |
| `recommendations.ts` | 231 | `getIdeaRecommendations()`, `runRecommendations()` — template matching, LLM decomposition, auto-execution, rejection penalization |
| `start.ts` | 422 | `handleWorkStart()` — the phase orchestrator with SIGINT management and centralized cleanup |
| `work.ts` | 35 | Facade: registers CLI commands and delegates to the modules above |

### Data flow through the modules

```
git-scan.ts
  scanGitHistory(repoPath) → GitScanResult { observations, traits }
    ↓
start.ts
  handleWorkStart(options)
    ├─ resetColdstartData(ctx, options)   → clears old coldstart data if --reset
    ├─ ensureIdentity(ctx, rlTracker)     → prompts for name/role if no identity
    ├─ checkRerun(ctx, options)           → skips interview if already completed
    ├─ gitScan(ctx)                       → calls scanGitHistory, adds observations
    ├─ createWorkspace(ctx)               → creates workspace in SQLite
    ├─ runInterview(ctx, onSigInt, rlTracker) → 10 questions via InterviewEngine
    ├─ deriveAndPreview(ctx, rlTracker)   → Derivator → preview → confirm/edit/restart
    └─ runRecommendations(ctx.db, engine, store, workspace) → from recommendations.ts
```

## Cooperative SIGINT cancellation

The SIGINT handling has two phases because the cleanup needs change mid-flow.

**Before workspace creation (phases 1-4):** A lightweight handler sets `sigintReceived = true` and closes the active readline interface. No database cleanup needed because no workspace exists yet.

**After workspace creation (phases 6-8):** The handler is swapped to one that also deletes the workspace. This prevents orphaned workspaces when the user presses Ctrl+C mid-interview.

The swap happens at line 365-375 of `start.ts`:

```typescript
cleanupSigInt = () => {
  sigintReceived = true;
  if (rlTracker.current) rlTracker.current.close();
  if (!ctx.completed && ctx.store && ctx.workspace) {
    ctx.store.deleteWorkspace(ctx.workspace.id);
  }
};
process.removeListener("SIGINT", onSigInt);
process.on("SIGINT", cleanupSigInt);
```

### The ReadlineTracker pattern

Node.js readline doesn't resolve its pending `question()` promise when the process receives SIGINT. The promise hangs forever, which means the process never exits. The `ReadlineTracker` fixes this:

```typescript
interface ReadlineTracker { current?: ReadlineInterface }
```

Each phase that opens a readline interface sets `rlTracker.current = rl` before awaiting input. The SIGINT handler calls `rlTracker.current.close()`, which resolves the pending promise with `undefined`. The phase then runs its `finally` block (which sets `rlTracker.current = undefined` and calls `rl.close()` again, which is a no-op on an already-closed interface).

This avoids the Bun-specific deadlock where `process.on("SIGINT")` + `rl.question()` never resolves because Bun doesn't propagate the signal to readline like Node.js does.

## Centralized cleanup

The `finally` block in `handleWorkStart` handles all cleanup in one place:

1. Remove both SIGINT listeners (the early one and the workspace-aware one)
2. If `!ctx.completed`: delete workspace and coldstart observations
3. Close the database connection

The `checkRerun` phase sets `completed: true` when it detects an existing coldstart. This prevents the `finally` block from deleting data that was already there before this run started. Without this guard, running `kai work start` a second time (without `--reset`) would delete the existing profile.

## Trade-offs

**PhaseResult adds indirection.** Each phase is a separate function with its own context merging. This is more code than a single linear function. The payoff is that each phase can be tested independently and the SIGINT check between phases is uniform.

**Two SIGINT handlers.** The swap from the early handler to the workspace-aware handler is subtle. A simpler approach would be a single handler that checks `ctx.workspace` existence. But that requires the handler to capture a mutable reference that changes mid-execution. The two-handler approach is explicit about when the behavior changes.

**`deleteColdstartObservations()` uses raw SQL.** This bypasses the ProfileEngine's observation API. The trade-off: the engine's `deleteObservation()` takes an observation ID, but the cleanup needs to delete all observations with `source = 'coldstart'` in one operation. Using raw SQL is honest about what it does.

## Alternatives considered

**State machine with explicit transitions.** Each phase would be a state with defined transitions to the next state or an error state. More rigorous but overkill for a linear pipeline with one branching point (checkRerun).

**Generator-based cancellation.** Using `yield` points where SIGINT can interrupt, similar to effect systems. Elegant but unfamiliar to most TypeScript contributors.

**Single readline instance.** Sharing one readline across all phases. This avoids the tracker pattern but couples the phases together and makes it harder to test them in isolation.
