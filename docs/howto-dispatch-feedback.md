# How to Provide Dispatch Feedback

How to approve or reject dispatch decisions so Kai's profile learns which agents work best for your tasks.

## Prerequisites

- Kai installed and on PATH
- MCP server running (`kai mcp serve`)
- At least one task executed via `kai_task_execute` (you need a `dispatch_id`)

## What dispatch feedback does

When Kai dispatches a task to an agent bridge, it records a dispatch decision: which agent ran, with what confidence, and why. The `kai_dispatch_feedback` tool lets you approve or reject that decision.

Your feedback becomes a profile observation. Approved dispatches reinforce the traits that drove the agent selection. Rejected dispatches penalize those traits. Over time, Kai learns which agents work best for your workflow.

## Approve a dispatch decision

After executing a task, the response includes a `dispatch_id`. Use it to approve:

```js
const result = await client.callTool({
  name: "kai_task_execute",
  arguments: { task_id: "task-uuid-here" },
});
// result.dispatch_id → "abc-123-def"

await client.callTool({
  name: "kai_dispatch_feedback",
  arguments: {
    dispatch_id: result.dispatch_id,
    decision: "approved",
  },
});
```

The response confirms:

```json
{ "dispatch_id": "abc-123-def", "decision": "approved", "recorded": true }
```

Kai records a profile observation with confidence 7 (strong positive signal).

## Reject a dispatch decision

If the wrong agent was chosen or the dispatch result was poor:

```js
await client.callTool({
  name: "kai_dispatch_feedback",
  arguments: {
    dispatch_id: "abc-123-def",
    decision: "rejected",
    reason: "Claude Code timed out on this task; should have used Hermes for a long-running job",
  },
});
```

Kai records a profile observation with confidence 4 (negative signal). The `reason` is optional but helps you track why you rejected it.

## Workflow: execute then review

A typical feedback loop:

1. **Submit and approve a plan** with mixed agent types
2. **Execute tasks** and collect dispatch IDs
3. **Review outputs** — which tasks produced good results?
4. **Approve or reject** each dispatch decision
5. **Check your profile** — `kai profile read` shows updated trait confidence

```js
// Execute a task
const exec = await client.callTool({
  name: "kai_task_execute",
  arguments: { task_id: "task-1" },
});

// Review the output, then provide feedback
if (exec.output && exec.output.length > 0) {
  await client.callTool({
    name: "kai_dispatch_feedback",
    arguments: {
      dispatch_id: exec.dispatch_id,
      decision: "approved",
    },
  });
} else {
  await client.callTool({
    name: "kai_dispatch_feedback",
    arguments: {
      dispatch_id: exec.dispatch_id,
      decision: "rejected",
      reason: "No output produced",
    },
  });
}
```

## What happens to the feedback

Feedback is stored in two places:

1. **dispatch_decisions table** — the `user_decision` column updates from `pending` to `approved` or `rejected`, with your optional reason
2. **Profile observations** — a new observation with key `dispatch:feedback:{dispatch_id}`, confidence 7 (approved) or 4 (rejected), and source `execution_result`

The profile observation feeds into Kai's derivation rules. Over time, consistent approval of one agent type for certain task domains strengthens the traits that drive that routing.

## Rules

- **Double-vote prevention:** You can only provide feedback on `pending` decisions. Once approved or rejected, the decision is locked.
- **Only successful dispatches create decisions:** If a task fails validation (already completed, wrong status, max retries exceeded), no dispatch decision row is created. There's nothing to approve or reject.
- **Feedback is best-effort:** If the profile engine is temporarily unavailable, feedback still updates the dispatch_decisions table. The profile observation may be lost, but the decision record persists.

## Troubleshooting

**"dispatch_not_found"** — The dispatch ID doesn't exist in the database. This happens when the task failed validation before reaching the bridge. No decision was created because no dispatch happened.

**"dispatch_already_decided"** — You already approved or rejected this decision. Each dispatch can only be decided once.

**Feedback not appearing in profile** — The profile observation emission is best-effort. If the database is locked or the profile engine hits an error, the observation is silently dropped. The dispatch_decisions table still records your decision.

## Related

- [How to Use Agent Bridges](howto-agent-bridges.md) — choosing and configuring agents
- [How the Orchestrator Works](explanation-orchestrator.md) — dispatch pipeline design
- [MCP Server Reference](reference-mcp-server.md) — `kai_dispatch_feedback` API details
- [Database Schema Reference](reference-database.md) — `dispatch_decisions` table structure
