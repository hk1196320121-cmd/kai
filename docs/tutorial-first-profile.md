# Tutorial: From Zero to First Derived Trait

Build a behavioral profile from scratch. You'll submit observations through the MCP server, derive a trait, and see the provenance chain explaining why that trait exists.

**What you'll build:** A working Kai profile with at least one derived trait that you can inspect and correct.

**Time:** ~5 minutes.

## What you'll need

- [Bun](https://bun.sh) installed
- Kai cloned and dependencies installed (`bun install`)
- Terminal access

## Step 1: Bootstrap your profile

```bash
bun run dev work start
```

Answer 10 interview questions about your work style and preferences. Kai also scans your git history (last 30 days) to detect patterns like commit times and branch naming. Review task recommendations matched to your profile, approve or skip, then confirm. The profile is stored at `~/.kai/kai.db`.

Verify it worked:

```bash
bun run dev profile read
```

You should see your identity fields. No traits yet — that's expected.

## Step 2: Start the MCP server

```bash
bun run dev mcp serve
```

The server starts listening on stdio. You'll see a log message like:

```
{"ts":"...","msg":"kai_mcp_server_started","data":{"dbPath":"/home/you/.kai/kai.db"}}
```

Leave this running. Open a new terminal for the next steps.

## Step 3: Submit observations

Use the MCP SDK to submit observations through the running server. In a separate terminal:

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

// Submit observations that match the "tinkerer" rule
for (const text of [
  "Tried 4 different CLI tools today",
  "Experimented with new frameworks all afternoon",
  "Installed and tested 3 experimental packages",
  "Spent morning comparing alternative architectures",
]) {
  await client.callTool({
    name: "observe.submit",
    arguments: { text, sourceTool: "tutorial" },
  });
}

// Derive traits from these observations
const result = await client.callTool({
  name: "derive.trigger",
  arguments: { method: "rules" },
});

console.log("Derived traits:", JSON.stringify(result, null, 2));
await client.close();
'
```

You should see derived traits in the output. The `tinkerer` rule matches observations about experimentation and tool usage.

## Step 4: See the result

```bash
bun run dev profile read
```

Now you'll see derived traits alongside your identity. The `tinkerer` trait should appear with a value and confidence score.

## Step 5: Ask why

```bash
bun run dev profile why tinkerer
```

This shows the provenance chain: which observations contributed, which rule matched, and the reasoning. You'll see the 4 observations you submitted and how they triggered the rule.

## Step 6: Correct if wrong

If the trait doesn't match reality:

```bash
bun run dev profile correct tinkerer
```

The trait is removed and a correction is recorded. Running `derive` again won't recreate it — the correction persists.

## What you built

You have a working Kai profile with:
- Identity from bootstrap
- Observations submitted through MCP
- A derived trait from rule-based analysis
- Provenance explaining why the trait exists
- A correction mechanism for wrong traits

**Next steps:**
- Connect a real AI agent (see [howto-connect-mcp-server.md](howto-connect-mcp-server.md))
- Explore the full MCP API (see [reference-mcp-server.md](reference-mcp-server.md))
- Understand confidence and decay (see [explanation-confidence-and-decay.md](explanation-confidence-and-decay.md))
