# How to Connect an AI Agent to Kai

Connect any MCP-compatible AI agent to Kai's profile server via stdio transport.

## Prerequisites

- Kai installed and on PATH (`bun link` from the repo, or `npm install -g`)
- A working profile database (`kai profile bootstrap` if first time)
- An MCP-compatible client (Claude Desktop, Cursor, or any MCP SDK client)

## Step 1: Verify Kai works

```bash
kai profile read
```

You should see your profile (or an empty profile message if no data yet). If this fails, run `kai profile bootstrap` first.

## Step 2: Configure your MCP client

Add Kai to your client's MCP server configuration.

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kai": {
      "command": "kai",
      "args": ["mcp", "serve"]
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "kai": {
      "command": "kai",
      "args": ["mcp", "serve"]
    }
  }
}
```

**Custom database path** — add `--db` flag:

```json
{
  "mcpServers": {
    "kai": {
      "command": "kai",
      "args": ["mcp", "serve", "--db", "/custom/path/profile.db"]
    }
  }
}
```

## Step 3: Restart your client

Close and reopen Claude Desktop / Cursor. The MCP server starts automatically when the client initializes.

## Step 4: Verify the connection

Ask your AI agent: "Read my Kai profile using the profile.read tool with scope summary."

Expected response: a summary of your identity and top traits.

## Step 5: Submit your first observation through the agent

Ask: "Submit an observation to Kai: text 'testing MCP connection', sourceTool 'manual'."

Expected response: a stored observation with an ID and timestamp.

## Troubleshooting

**"kai: command not found"** — Kai is not on PATH. Run `bun link` from the Kai repo, or use the full path to the binary.

**"Cannot find module"** — Dependencies not installed. Run `bun install` in the Kai repo.

**No profile data returned** — Database is empty. Run `kai profile bootstrap` to create initial identity, then `kai observe daily` to collect observations.

**Rate limit errors** — You're submitting too fast. Kai allows 60 `observe.submit` calls per minute. Use `observe.batch` for bulk submissions instead.

**Server not appearing in client** — Check the config file path and JSON syntax. Restart the client completely (not just reload).

## Using with MCP SDK

If you're building a custom client with the MCP SDK:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "kai",
  args: ["mcp", "serve"],
});

const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(transport);

// Read profile summary
const result = await client.callTool({
  name: "profile.read",
  arguments: { scope: "summary" },
});

// Submit observation
await client.callTool({
  name: "observe.submit",
  arguments: {
    text: "User opened 3 PRs today",
    sourceTool: "github-agent",
    confidence: 0.8,
  },
});

// Read a resource
const traits = await client.readResource({
  uri: "kai://profile/traits",
});
```
