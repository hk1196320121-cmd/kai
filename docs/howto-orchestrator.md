# How to Use the Orchestrator

Common workflows for submitting ideas, managing plans, executing tasks, and responding to behavioral changes.

## Prerequisites

- Kai installed and on PATH (`bun link` from the repo)
- A working profile (`kai work start` if you haven't yet)
- `OPENAI_API_KEY` set for LLM-powered planning
- MCP server running (`kai mcp serve`)

## Submit an idea

Submit a new idea with a title, optional description, domain, and priority:

```bash
# Via MCP SDK
await client.callTool({
  name: "kai_idea_submit",
  arguments: {
    title: "Refactor the authentication module",
    description: "Split auth.ts into separate modules for session management, token validation, and password hashing",
    domain: "coding",
    priority: "high",
  },
});
```

**Domains:** `coding`, `writing`, `research`, `creative`, `general` (default: `general`).

**Priorities:** `low`, `medium`, `high`, `critical` (default: `medium`).

The response includes `suggested_clusters` — themes Kai detected from your recent observations that relate to this idea. Use them to decide if similar ideas already exist.

## Decompose an idea into tasks

```bash
await client.callTool({
  name: "kai_idea_plan",
  arguments: { idea_id: "idea-uuid-here" },
});
```

The planner produces 3-8 tasks, each with:
- `title` and `description` — what the task does
- `prompt` — the full instruction for the agent
- `agent` — target agent (defaults to `hermes`)
- `scheduledFor` — suggested execution time based on your profile

If the LLM fails, the planner falls back to a single task. Tasks that don't pass validation (missing title/description/prompt) are silently dropped.

## Approve and schedule a plan

Approve a plan as-is:

```bash
await client.callTool({
  name: "kai_plan_approve",
  arguments: { idea_id: "idea-uuid-here" },
});
```

Or modify specific tasks during approval:

```bash
await client.callTool({
  name: "kai_plan_approve",
  arguments: {
    idea_id: "idea-uuid-here",
    task_modifications: [
      { task_id: "task-1", action: "update", field: "agent", value: "hermes" },
      { task_id: "task-2", action: "update", field: "cron_schedule", value: "0 8 * * 1-5" },
      { task_id: "task-3", action: "remove" },
    ],
  },
});
```

**Allowed update fields:** `title`, `prompt`, `cron_schedule`, `agent`, `type`. Cron schedules are validated against a standard 5-field format.

One-off tasks are dispatched immediately. Cron tasks are scheduled via the agent bridge with profile-aware hour adjustment: early risers (trait >= 0.6) get morning slots (6-9 AM), night owls (trait <= 0.4) get evening slots (7 PM+).

## Execute a task

```bash
await client.callTool({
  name: "kai_task_execute",
  arguments: { task_id: "task-uuid-here" },
});
```

The dispatcher sends the task to the agent bridge. On failure, it retries once (up to `max_retries`, default 2). Cron tasks cannot be dispatched this way — they are scheduled, not manually executed.

## Check execution status

```bash
# Status for all tasks in an idea
await client.callTool({
  name: "kai_execution_status",
  arguments: { idea_id: "idea-uuid-here" },
});

# Status for a specific task, with feedback
await client.callTool({
  name: "kai_execution_status",
  arguments: {
    task_id: "task-uuid-here",
    feedback: "The refactoring approach worked well",
  },
});
```

The response includes task statuses, execution results, and any profile observations generated from the execution. Feedback is capped at 2000 characters and becomes a profile observation.

## Pause an idea

Pause all work on an idea:

```bash
await client.callTool({
  name: "kai_idea_pause",
  arguments: { idea_id: "idea-uuid-here" },
});
```

All pending and scheduled tasks are paused. Cron jobs are cancelled via the agent bridge. Completed and failed tasks are unaffected.

## Re-plan an idea

When your behavioral profile has shifted or the plan no longer fits:

```bash
await client.callTool({
  name: "kai_replan",
  arguments: { idea_id: "idea-uuid-here" },
});
```

This deletes all non-completed, non-failed tasks and re-decomposes the idea using your current profile. The response shows the old and new task counts.

## Idea lifecycle

```
draft → planned → executing → completed
                 ↘ paused → (re-plan returns to draft)
```

| Status | Meaning |
|--------|---------|
| `draft` | Idea submitted, not yet planned |
| `planned` | Decomposed into tasks, awaiting approval |
| `executing` | Tasks are scheduled and running |
| `completed` | All tasks finished |
| `paused` | Work halted, tasks paused |

## Task lifecycle

```
pending → scheduled → executing → completed
                                    ↘ failed
```

| Status | Meaning |
|--------|---------|
| `pending` | Created by planner, not yet scheduled |
| `scheduled` | Approved and dispatched or cron-set |
| `executing` | Currently running |
| `completed` | Finished successfully |
| `failed` | Finished with errors (after retries exhausted) |
| `paused` | Parent idea was paused |

## Trait-based schedule adjustments

The scheduler reads specific traits to personalize timing:

| Trait | Threshold | Effect |
|-------|-----------|--------|
| `early_riser` | >= 0.6 | Cron tasks scheduled 6-9 AM |
| `early_riser` | <= 0.4 | Cron tasks scheduled 7 PM+ |
| `early_riser` | 0.4-0.6 | Default: 9 AM |

Default cron schedule: `0 9 * * *` (daily at 9 AM).

## Closed-loop change detection

The closed-loop engine compares your current traits against a snapshot taken when the plan was created. A "significant change" triggers when:

- Trait value shifts by >= 0.15 (on a 0-1 scale)
- Trait confidence shifts by >= 2 (on a 1-10 scale)

These thresholds can be tuned via profile preferences:
- `orchestrator.replan_threshold_value` — value delta (default: 0.15)
- `orchestrator.replan_threshold_confidence` — confidence delta (default: 2)

## Troubleshooting

**"Idea not found"** — Check the idea ID. Use `kai_execution_status` without filters to list all ideas, or query the database directly.

**Plan produces fewer tasks than expected** — The planner requires at least 3 valid tasks from the LLM. If the LLM returns fewer, it retries with a simpler prompt. If that fails, it falls back to a single task. Check that `OPENAI_API_KEY` is set.

**Tasks not executing** — One-off tasks are dispatched immediately on approval. Cron tasks wait for their schedule. The agent bridge writes job files to `~/.hermes/cron/pending/` — check that the Hermes daemon is running.

**Re-plan does nothing** — Re-planning only deletes non-terminal tasks (pending, scheduled, paused). If all tasks are completed or failed, re-planning has nothing to replace.

**Clustering returns no suggestions** — Clustering scans the last 7 days of observations (up to 500). Words must appear at least 3 times to qualify. If you have few observations, clusters won't form.

## Related

- [MCP Server Reference](reference-mcp-server.md) — complete API for all 7 orchestrator tools
- [Tutorial: From Idea to Execution](tutorial-first-idea.md) — step-by-step walkthrough
- [How the Orchestrator Works](explanation-orchestrator.md) — design rationale and trade-offs
- [Confidence & Decay](explanation-confidence-and-decay.md) — how traits change over time
