# Why Workspace Events Become Observations

How Kai's event bus bridges workspace activity and the profile engine, and why this design keeps your profile current without manual updates.

## The problem

Without a bridge between workspaces and profiles, your behavioral traits only update when you explicitly run `kai profile derive` or start a new cold start. If you complete 20 tasks this week, your profile has no idea. The traits grow stale even while you're actively working.

Manual derivation is fine for periodic refreshes, but it misses the real-time picture. You'd need to remember to run derive after every meaningful change.

## The approach

The event bus sits between the workspace system and the profile engine. Every workspace state change passes through it:

```
Task completed → Event bus → Observation (confidence 7/10) → Profile engine
Task created   → Event bus → Observation (confidence 4/10) → Profile engine
Cold start Q&A → Event bus → Observation (confidence 8/10) → Profile engine
```

The bus converts each event into an observation with:
- A namespaced key: `workspace:task_completed`, `workspace:coldstart_answer`
- A confidence score mapped from event type
- Source set to `workspace` (distinguishing it from `coldstart`, `mcp`, or `cron_output`)

### Confidence mapping

Not all events carry equal weight. The confidence mapping reflects how much each event type reveals about behavior:

| Event type | Confidence | Reasoning |
|-----------|------------|-----------|
| `coldstart_answer` | 8 | Direct self-assessment — high signal |
| `task_completed` | 7 | Demonstrates follow-through — strong behavioral signal |
| `interaction` | 6 | General activity — moderate signal |
| `task_updated` | 5 | In-progress work — some signal |
| `task_created` | 4 | Intent, not action — weaker signal |
| `workspace_created` | 3 | Administrative — minimal behavioral signal |

### State-change triggers

Only certain events trigger derivation (a process where the engine re-examines observations to update traits). These are events that represent meaningful state transitions:

- `task_completed` — finishing work changes your completion rate trait
- `workspace_archived` — closing a workspace signals a work cycle ending

Other events (task created, task updated) become observations but don't immediately trigger derivation. They contribute to the observation pool for the next derivation run.

## Trade-offs

**Eventual consistency over real-time.** State-change triggers run derivation, but the observations from non-trigger events accumulate for the next manual `derive` call. This keeps the system responsive without running derivation on every keystroke.

**No filtering by workspace age or size.** The event bus processes all events equally. A workspace with 1 event gets the same treatment as one with 100. This is intentional: the derivation rules handle volume through confidence scaling, not event filtering.

**Error resilience.** If the store fails during event processing, the bus returns an empty result and logs the error. It never crashes the workspace operation. Observations that fail to process are simply lost — there's no retry queue. This trades completeness for reliability.

## How it connects to the derivation pipeline

```
Workspace event
  → eventToObservation() — converts to AddObservationInput
  → processStateChange() — filters by event type, queries related events
  → observations added to engine
  → if state-change event: shouldDerive = true
  → derivator.deriveFromRules() — applies coldstart/workspace rules
  → traits updated (respecting source precedence)
```

The coldstart/workspace derivation rules in the derivator look for `workspace:*` and `coldstart:*` observation keys. They don't look at events directly. The event bus is the translation layer.

## Alternatives considered

**Direct trait updates from events.** Instead of converting events to observations and running derivation, the event bus could set traits directly. Rejected because it bypasses the derivation pipeline's confidence aggregation and cross-rule merging. Multiple events for the same dimension (e.g., detail_oriented from both coldstart answers and commit messages) need to be merged, which the derivator handles.

**Event sourcing with full replay.** Storing every event and replaying them on demand to reconstruct the profile. Rejected as over-engineering for the current volume. The observation table already serves as the durable record. Replaying events would add complexity without improving accuracy.

## Related

- [How to Use Workspaces](howto-workspace.md) — practical workspace management
- [Confidence & Decay](explanation-confidence-and-decay.md) — how confidence scales and decay work
- [MCP Server Reference](reference-mcp-server.md) — the `derive.trigger` tool that runs the derivation pipeline
