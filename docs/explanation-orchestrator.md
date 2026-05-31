# How the Orchestrator Works

Why Kai's idea-to-execution engine adapts to behavioral profiles, how the closed loop keeps plans current, and what trade-offs the design makes.

## The problem

Without an orchestrator, Kai can observe your behavior and derive traits, but it can't act on them. Your profile says "early riser, detail-oriented, prefers structured plans" but nothing uses that information to help you get work done. The profile is passive.

The orchestrator bridges this gap. It takes a goal you describe, decomposes it into concrete tasks, schedules them at times aligned with your behavioral patterns, dispatches them to agent bridges for execution, and watches the results to keep your profile current.

## The pipeline

```
Idea (you describe a goal)
  → Planner (LLM decomposes into tasks, reading your profile)
    → Scheduler (assigns times using behavioral traits)
      → Dispatcher (sends to agent bridge)
        → Agent bridge (writes job files for execution)
          → Observer (converts results into profile observations)
            → Closed loop (detects trait changes → re-plan)
```

Each stage is a separate module with a single responsibility. The store (SQLite) holds the state between stages.

## Profile-aware planning

The planner is the most complex stage. It works in three layers:

1. **Profile context formatting** — `formatProfileContext()` reads your traits and produces scheduling guidance. If `early_riser >= 0.6`, the context says "Schedule tasks in morning hours." If `detail_oriented >= 0.6`, it says "Break into fine-grained steps." Traits between 0.4 and 0.6 produce no guidance (neutral zone).

2. **LLM decomposition** — The planner sends the idea plus profile context to the LLM. The user's idea is wrapped in delimiter markers labeled "untrusted input" — a trust boundary (a way to separate user-provided content from system instructions, preventing the user's text from being interpreted as commands to the LLM). The system prompt tells the LLM: never include raw profile data in task descriptions.

3. **Fallback chain** — If the full profile-aware prompt fails, the planner retries with a simpler prompt. If that fails too, it creates a single task from the raw idea description. The system always produces at least one task.

**Why profile-aware?** A generic planner would schedule tasks at arbitrary times and decompose with arbitrary granularity. By reading your traits, the planner adapts: morning tasks for early risers, detailed breakdowns for detail-oriented users, broader scopes for high scope-appetite users. The plan fits the person.

**Trade-off:** The planner is only as good as the profile data. A new user with few traits gets the same plan as a generic planner would produce. Profile-awareness improves with use.

## Scheduling with behavioral traits

The scheduler reads the `early_riser` trait to adjust cron task timing:

- `early_riser >= 0.6`: tasks scheduled 6-9 AM (earlier for higher values)
- `early_riser <= 0.4`: tasks scheduled 7 PM or later
- Between 0.4 and 0.6: default 9 AM

**Why just early_riser?** In the current implementation, scheduling only uses the early_riser trait because it has the most direct, measurable impact on task timing. Other traits (detail_oriented, scope_appetite) influence decomposition granularity via the planner, not timing. Future versions could add more trait-based scheduling rules.

**Trade-off:** Trait-based scheduling is coarse. A single trait maps to a time range, not a personalized calendar. The scheduler doesn't consider competing tasks, deadlines, or workload.

## The observer pipeline

After a task executes, the observer converts the result into profile observations:

| Observation | Key | Confidence | When |
|------------|-----|-----------|------|
| Task completion | `execution:task_completion:{id}` | 7 (success) / 4 (failure) | Always |
| Duration | `execution:duration:{id}` | 5 | Always |
| Domain activity | `execution:domain:{domain}` | 7 | When idea has a domain |
| User feedback | `execution:feedback:{id}` | 6 | When feedback provided |

These observations have source `execution_result`, distinguishing them from MCP, cron, coldstart, and workspace sources.

**Why observe execution results?** Without the observer, execution is a dead end. Tasks run, but the profile doesn't learn from them. The observer closes the loop: execution results feed back into the profile, which influences future planning.

**Trade-off:** Every execution produces multiple observations. A high-volume orchestrator (many ideas, many tasks) generates significant observation volume. The observer doesn't deduplicate — each execution result produces fresh observations. This is intentional: repeated patterns strengthen trait confidence.

## Idea clustering

The clusterer scans recent observations (last 7 days, max 500) using word-frequency analysis. It tokenizes observation text, counts word occurrences, filters stop words, and returns the top 5 recurring themes that don't already match existing ideas.

**Why TF-IDF-style tokenization over embeddings?** Tokenization is fast, requires no external API, and works well for single-word theme detection. Embeddings would catch semantic similarity ("Rust" ≈ "systems programming") but add latency and a dependency. The current approach trades semantic depth for speed and simplicity.

**Why 3 minimum occurrences?** Below 3, a word could be noise — a single mention in one observation. At 3+, it represents a pattern.

**Trade-off:** The clusterer only catches exact word matches, not semantic themes. "API" and "endpoint" are treated as separate themes. This keeps the system fast but may miss broader patterns.

## Closed-loop engine

The closed-loop engine compares your current traits against a snapshot:

1. When a plan is created, the engine takes a snapshot of all trait values and confidence scores.
2. After execution, `detectSignificantChanges()` compares current traits against the snapshot.
3. A change is significant if: value delta >= 0.15 or confidence delta >= 2.
4. If changes are detected, `kai_replan` can re-decompose the idea with the updated profile.

**Why these thresholds?** A value delta of 0.15 on a 0-1 scale means a trait shifted at least 15% (e.g., 0.5 → 0.65). A confidence delta of 2 on a 1-10 scale means confidence changed by at least two levels. These are high enough to avoid false triggers from small fluctuations, but low enough to catch meaningful behavioral shifts.

**Why manual re-planning instead of automatic?** The current implementation requires calling `kai_replan` explicitly. Automatic re-planning would be more responsive but could disrupt in-progress work. The manual approach gives you control over when plans change.

**Trade-off:** Snapshots are in-memory. If the server restarts, the snapshot is lost and re-created from current traits. This means the engine can't detect changes across restarts without re-planning at least once.

## Agent bridge

Kai uses a **CompositeBridge** that routes tasks to the right agent:

| Agent | Bridge | Behavior |
|-------|--------|----------|
| `claude` | ClaudeCodeBridge | Dispatches via `claude --print` subprocess with 120s timeout, 1MB output capture, and concurrent pipe drain |
| `hermes` | HermesBridge | Writes job files to `~/.hermes/cron/pending/` (file-based dispatch) |
| `auto` | → ClaudeCodeBridge with HermesBridge fallback | Tries claude first; if it fails, falls back to hermes |
| `openclaw` | → HermesBridge | Alias: routes to hermes bridge |

**Non-retryable dispatch:** Subprocess agents (claude) skip retry on failure to avoid duplicate file edits. Failed tasks are marked `failed` immediately instead of retrying.

**Dispatch decisions:** When the dispatcher sends a task, it creates a `dispatch_decisions` row recording the agent, confidence, and reasoning. Users can approve or reject these decisions via `kai_dispatch_feedback`, which flows back as profile observations.

**Why file-based for Hermes?** The Hermes agent reads jobs from the filesystem. This decouples Kai from Hermes — Kai doesn't need to know if Hermes is running, and Hermes doesn't need an API server. The filesystem is the message queue.

**Why subprocess for Claude?** Claude Code CLI runs as a subprocess (`claude --print`), providing direct access to the code agent without a separate daemon. Output is captured with a 1MB cap; excess data is drained to prevent child process deadlock.

**Trade-off:** There's no acknowledgment mechanism for Hermes. Kai writes the file and assumes Hermes will pick it up. If the pending directory is full of stale jobs, there's no cleanup or backpressure (a mechanism to slow down producers when consumers can't keep up).

## The full data model

```
Idea
  ├── id (UUID)
  ├── title, description, domain, priority
  ├── status (draft → planned → executing → completed / paused)
  └── Planned Tasks (3-8 per idea)
        ├── title, description, prompt
        ├── type (one_off or cron)
        ├── cron_schedule (for cron tasks)
        ├── agent (hermes / openclaw / auto / claude)
        ├── status (pending → scheduled → executing → completed / failed / paused)
        ├── retry_count, max_retries (default: 2)
        └── Execution Results (0+ per task)
              ├── success (boolean)
              ├── output
              ├── duration_ms
              └── user_feedback (optional)
```

Database tables: `ideas`, `planned_tasks`, `execution_results` (added in V5 migration), `dispatch_decisions` (added in V10 migration).

## Alternatives considered

**DAG-based task dependencies.** Instead of a flat list, tasks could depend on each other (task B runs after task A completes). Rejected for v1 because it adds scheduling complexity without clear user benefit for the typical "decompose a goal" use case. The flat model is simpler and sufficient for most idea decomposition.

**Embedded LLM for clustering.** Instead of TF-IDF tokenization, use an LLM to identify semantic themes. Rejected for v1 because of latency and cost. TF-IDF is fast enough for real-time suggestion during idea submission.

**Automatic re-planning.** Trigger replan automatically when the closed-loop engine detects significant changes. Deferred to a future version. The current manual approach (call `kai_replan`) gives the user control and avoids disrupting in-progress work.

## Related

- [How to Use the Orchestrator](howto-orchestrator.md) — practical workflows for all 7 tools
- [Tutorial: From Idea to Execution](tutorial-first-idea.md) — step-by-step walkthrough
- [MCP Server Reference](reference-mcp-server.md) — complete API reference for orchestrator tools
- [Confidence & Decay](explanation-confidence-and-decay.md) — how traits change over time
- [Event Bus](explanation-event-bus.md) — how workspace events become observations
