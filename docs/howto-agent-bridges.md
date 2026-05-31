# How to Use Agent Bridges for Task Dispatch

How to choose the right agent for task execution, configure agent routing, and handle dispatch failures in Kai's orchestrator.

## Prerequisites

- Kai installed and on PATH (`bun link` from the repo)
- MCP server running (`kai mcp serve`)
- An idea with approved tasks (see [How to Use the Orchestrator](howto-orchestrator.md))

## Available agents

Kai dispatches tasks to agent bridges. Each bridge connects to a different execution engine:

| Agent | Bridge | Execution | Retryable | Output |
|-------|--------|-----------|-----------|--------|
| `claude` | ClaudeCodeBridge | Subprocess (`claude --print`) | No | Captured (up to 1MB) |
| `hermes` | HermesBridge | File-based job to `~/.hermes/cron/pending/` | Yes (default 2 retries) | Polled from result files |
| `auto` | CompositeBridge (claude, then hermes fallback) | Starts with subprocess, falls back to file-based | Fallback path: yes | Depends on which bridge handles it |
| `openclaw` | HermesBridge (alias) | Same as `hermes` | Yes | Same as `hermes` |

## Choose an agent for a task

When you approve a plan, each task has an `agent` field. You can set it during plan approval:

```js
await client.callTool({
  name: "kai_plan_approve",
  arguments: {
    idea_id: "idea-uuid-here",
    task_modifications: [
      // Use Claude Code for code generation tasks
      { task_id: "task-1", action: "update", field: "agent", value: "claude" },

      // Use Hermes for scheduled/recurring tasks
      { task_id: "task-2", action: "update", field: "agent", value: "hermes" },

      // Let Kai decide (tries claude first, falls back to hermes)
      { task_id: "task-3", action: "update", field: "agent", value: "auto" },
    ],
  },
});
```

**When to use each agent:**

- **`claude`** — code generation, file editing, multi-step reasoning. Claude Code runs as a subprocess and returns output directly. Best for one-off tasks that produce text output.
- **`hermes`** — scheduled/cron tasks, long-running jobs, external tool integrations. Hermes picks up job files from the filesystem and runs them asynchronously.
- **`auto`** — the safe default. Tries Claude Code first; if the `claude` binary isn't available (AGENT_NOT_FOUND error), falls back to Hermes automatically.
- **`openclaw`** — alias for `hermes`. Routes to the Hermes bridge directly.

## How Claude Code bridge execution works

When a task is dispatched to `claude`:

1. Kai spawns `claude --print` as a subprocess
2. The task prompt is sent via stdin (not command-line arguments, to avoid length limits)
3. Kai reads stdout and stderr concurrently (prevents pipe deadlock at high output)
4. Output is capped at 1MB; excess data is drained to prevent the child process from hanging
5. If the process doesn't finish within 120 seconds, Kai sends SIGTERM, then SIGKILL after 5 seconds

The task completes synchronously. If the subprocess exits with code 0, the task status moves to `completed` with the captured output. If it fails, the task status moves to `failed` immediately.

**Non-retryable behavior:** Claude Code tasks are never retried on failure. If `claude --print` fails partway through a file edit, retrying could produce duplicate or conflicting changes. Instead, the task is marked `failed` so you can inspect the output and decide what to do.

## How auto-routing with fallback works

When `agent: "auto"`:

1. Kai resolves `auto` → `claude` and dispatches to ClaudeCodeBridge
2. If the dispatch fails with `AGENT_NOT_FOUND` (claude binary not in PATH), Kai retries the dispatch via HermesBridge
3. If the dispatch fails for any other reason (timeout, execution error), the fallback does NOT activate

This means `auto` only falls back when Claude Code is not installed. It does not fall back on timeout or execution errors.

## Check dispatch results

After executing a task:

```js
const result = await client.callTool({
  name: "kai_task_execute",
  arguments: { task_id: "task-uuid-here" },
});
```

The response includes:

| Field | When present | Meaning |
|-------|-------------|---------|
| `success` | Always | Whether the dispatch succeeded |
| `dispatch_id` | On success | ID for the dispatch decision (use with `kai_dispatch_feedback`) |
| `agent` | Always | Which agent handled the task |
| `output` | On success (sync bridges) | Captured stdout from the subprocess |
| `error` | On failure | Error category and message |

## Troubleshooting

**"AGENT_NOT_FOUND: claude binary not found in PATH"** — Claude Code CLI is not installed or not on PATH. Install it with `npm install -g @anthropic-ai/claude-code` or switch the task agent to `hermes`.

**"TIMEOUT: claude subprocess exceeded timeout"** — The task prompt took longer than 120 seconds. Simplify the prompt, or switch to `hermes` for long-running tasks.

**Task marked `failed` immediately without retry** — This is expected for `claude` agent tasks. Subprocess agents skip retry to prevent duplicate file edits. Check the `output` field for partial results and the `error` field for the failure reason.

**Output is truncated** — Output exceeding 1MB is silently truncated. The excess is drained to prevent the child process from deadlocking. If you need full output, break the task into smaller pieces.

## Related

- [How the Orchestrator Works](explanation-orchestrator.md) — agent bridge design rationale and trade-offs
- [How to Use the Orchestrator](howto-orchestrator.md) — full orchestrator workflow
- [How to Provide Dispatch Feedback](howto-dispatch-feedback.md) — approve or reject dispatch decisions
- [MCP Server Reference](reference-mcp-server.md) — complete API for orchestrator tools
