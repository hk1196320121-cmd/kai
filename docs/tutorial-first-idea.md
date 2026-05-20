# Tutorial: From Idea to Execution

Submit an idea, decompose it into tasks, schedule and execute them, and watch the results feed back into your profile. By the end, you'll understand how the orchestrator turns a goal into action using your behavioral data.

**What you'll build:** A working idea that gets planned by an LLM, scheduled with profile-aware timing, executed through an agent bridge, and observed by the profile engine.

**Time:** ~10 minutes.

## What you'll need

- [Bun](https://bun.sh) installed
- Kai cloned and dependencies installed (`bun install`)
- A working profile with at least a few traits (run `kai work start` first)
- `OPENAI_API_KEY` environment variable set (the planner uses LLM decomposition)
- Terminal access

## Step 1: Start the MCP server

```bash
bun run dev mcp serve
```

The server starts on stdio. Leave it running and open a new terminal.

## Step 2: Submit an idea

Use the MCP SDK to submit an idea:

```bash
bun -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "src/cli/index.ts", "mcp", "serve"],
});

const client = new Client({ name: "tutorial", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "kai_idea_submit",
  arguments: {
    title: "Add error tracking to the API",
    description: "Instrument all API endpoints with structured error logging and add a /health/error-stats endpoint",
    domain: "coding",
    priority: "high",
  },
});

console.log(JSON.stringify(result, null, 2));
await client.close();
'
```

You should see the created idea with an ID, status `"draft"`, and possibly `suggested_clusters` — themes Kai detected from your recent observations that relate to this idea.

## Step 3: Plan the idea

Decompose the idea into tasks using the planner:

```bash
bun -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "src/cli/index.ts", "mcp", "serve"],
});

const client = new Client({ name: "tutorial", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "kai_idea_plan",
  arguments: { idea_id: "YOUR_IDEA_ID" },
});

console.log(JSON.stringify(result, null, 2));
await client.close();
'
```

Replace `YOUR_IDEA_ID` with the ID from Step 2.

The planner reads your behavioral profile and decomposes the idea into 3-8 tasks. If you're an early riser (trait `early_riser >= 0.6`), tasks get scheduled for morning hours. The planner adapts task structure to traits like `detail_oriented` and `scope_appetite`.

The idea status changes to `"planned"`.

## Step 4: Approve the plan

Review the tasks and approve:

```bash
bun -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "src/cli/index.ts", "mcp", "serve"],
});

const client = new Client({ name: "tutorial", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "kai_plan_approve",
  arguments: {
    idea_id: "YOUR_IDEA_ID",
    task_modifications: [
      {
        task_id: "TASK_ID_TO_MODIFY",
        action: "update",
        field: "agent",
        value: "hermes",
      },
    ],
  },
});

console.log(JSON.stringify(result, null, 2));
await client.close();
'
```

You can modify task fields during approval. Allowed fields: `title`, `description`, `agent`, `cron_schedule`. Tasks without modifications are approved as-is.

The scheduler dispatches one-off tasks immediately and schedules cron tasks according to your profile. Job files are written to `~/.hermes/cron/pending/`.

## Step 5: Execute a task

Dispatch a specific task for execution:

```bash
bun -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "src/cli/index.ts", "mcp", "serve"],
});

const client = new Client({ name: "tutorial", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "kai_task_execute",
  arguments: { task_id: "YOUR_TASK_ID" },
});

console.log(JSON.stringify(result, null, 2));
await client.close();
'
```

The dispatcher sends the task to the agent bridge. If the first attempt fails, it retries once automatically (max 2 retries per task).

## Step 6: Check execution status

See how all tasks are progressing and submit feedback:

```bash
bun -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "src/cli/index.ts", "mcp", "serve"],
});

const client = new Client({ name: "tutorial", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "kai_execution_status",
  arguments: {
    idea_id: "YOUR_IDEA_ID",
    feedback: "The error logging approach worked well for the API layer",
  },
});

console.log(JSON.stringify(result, null, 2));
await client.close();
'
```

This returns all tasks with their execution status, plus any profile observations generated from execution results. The feedback you submit becomes a profile observation with source `execution_result`.

## Step 7: Verify profile impact

```bash
bun run dev profile read
```

Check for new observations with source `execution_result`. The observer converts execution outcomes into behavioral observations: task completion patterns, duration signals, and domain activity.

If your behavioral traits shifted significantly since the plan was created (value delta >= 0.15 or confidence delta >= 2), the closed-loop engine detects the change and you can re-plan:

```bash
bun -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "src/cli/index.ts", "mcp", "serve"],
});

const client = new Client({ name: "tutorial", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "kai_replan",
  arguments: { idea_id: "YOUR_IDEA_ID" },
});

console.log(JSON.stringify(result, null, 2));
await client.close();
'
```

Re-planning deletes pending tasks and re-decomposes the idea with your updated profile.

## What you built

You have a working orchestrator pipeline that:
- Submitted an idea and detected related themes from your observation history
- Decomposed it into tasks using LLM analysis adapted to your behavioral traits
- Scheduled tasks with profile-aware timing
- Executed tasks through an agent bridge with automatic retry
- Fed execution results back into your profile as observations
- Detected behavioral changes that could trigger re-planning

**Next steps:**
- Explore the full MCP API for orchestrator tools: [MCP Server Reference](reference-mcp-server.md)
- Understand why the orchestrator adapts to your profile: [How the Orchestrator Works](explanation-orchestrator.md)
- Common orchestrator workflows: [How to Use the Orchestrator](howto-orchestrator.md)
