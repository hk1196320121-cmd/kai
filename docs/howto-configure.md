# How to Configure Kai

Setting up environment variables, LLM provider, database path, and Hermes integration.

## Prerequisites

- [Bun](https://bun.sh) installed
- Kai cloned and dependencies installed (`bun install`)

## Environment variables

All configuration is via environment variables. No config files needed.

| Variable | Default | What it controls |
|----------|---------|------------------|
| `KAI_DB` | `~/.kai/kai.db` | SQLite database path. Created automatically on first use |
| `HERMES_HOME` | `~/.hermes` | Hermes home directory. Kai scans `$HERMES_HOME/cron/` for cron output files |
| `LLM_API_KEY` | (empty) | API key for LLM calls. Required for profile derivation (`method: "llm"`) and orchestrator planning |
| `LLM_BASE_URL` | `http://localhost:11434/v1` | LLM API endpoint. OpenAI-compatible `/chat/completions` format |
| `LLM_MODEL` | `gpt-4o-mini` | Model name sent to the LLM API |

## Set up LLM for trait derivation

The profile engine can use an LLM to infer traits that the built-in rules don't catch. This also powers the orchestrator's task decomposition.

**Option A: OpenAI**

```bash
export LLM_API_KEY="sk-..."
export LLM_BASE_URL="https://api.openai.com/v1"
export LLM_MODEL="gpt-4o-mini"
```

**Option B: Local model via Ollama**

```bash
# Start Ollama with a model that supports JSON output
ollama pull llama3
ollama serve

# Kai defaults to localhost:11434, so just set the model
export LLM_MODEL="llama3"
# No API key needed for local Ollama
```

**Option C: OpenAI-compatible provider (Groq, Together, etc.)**

```bash
export LLM_API_KEY="gsk_..."
export LLM_BASE_URL="https://api.groq.com/openai/v1"
export LLM_MODEL="llama-3.1-8b-instant"
```

## Verify LLM is working

```bash
# Set your env vars, then run derivation with LLM
kai profile derive  # Rules only (no LLM key needed)

# Via MCP — uses LLM
# Call derive.trigger with method: "llm"
```

The LLM provider retries on 429 (rate limit) and 5xx (server error) with exponential backoff. Client errors (400, 401, 403) fail immediately without retry.

## Change the database path

```bash
# CLI commands use $KAI_DB
export KAI_DB=/custom/path/kai.db
kai profile read

# MCP server
kai mcp serve --db /custom/path/kai.db
```

The database directory is created automatically if it doesn't exist. Migrations run on first connect.

## Connect to Hermes

Kai reads cron outputs from the Hermes file system. By default, it looks at `~/.hermes/cron/`.

If Hermes is installed at a custom location:

```bash
export HERMES_HOME=/path/to/hermes
kai observe daily
```

The `observe daily` command scans `$HERMES_HOME/cron/` for `.md` files and extracts observations using pattern matching.

## Use Kai with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Set `LLM_API_KEY` in your shell profile so the MCP server inherits it. Restart Claude Desktop after config changes.

See [How to Connect an AI Agent](howto-connect-mcp-server.md) for Cursor and custom client setup.

## Persist environment variables

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
# Kai configuration
export KAI_DB="$HOME/.kai/kai.db"
export HERMES_HOME="$HOME/.hermes"
export LLM_API_KEY="sk-..."
export LLM_BASE_URL="https://api.openai.com/v1"
export LLM_MODEL="gpt-4o-mini"
```

## Troubleshooting

**"LLM API error: 401"** — Check your `LLM_API_KEY`. For OpenAI, the key starts with `sk-`. For Ollama, no key is needed.

**"Invalid JSON in LLM response"** — The model returned non-JSON. This happens with small models that don't support `response_format: { type: "json_object" }`. Try a different model or ensure the model supports JSON mode.

**"No observations to derive traits from"** — The database has no observations. Run `kai observe daily` or `kai work start` to collect data first.

**"LLM call failed after retries"** — The API endpoint is unreachable or returning persistent errors. Check `LLM_BASE_URL` and network connectivity. For local Ollama, make sure `ollama serve` is running.

**Database locked errors** — Only one process should write to the SQLite file at a time. If you run `kai mcp serve` and `kai profile derive` simultaneously, the WAL mode handles concurrent reads, but writes may briefly block. The 5000ms busy timeout usually resolves this.

## Related

- [CLI Reference](reference-cli.md) — all commands and flags
- [Database Schema Reference](reference-database.md) — tables, migrations, data model
- [How to Connect an AI Agent](howto-connect-mcp-server.md) — MCP client setup
- [Confidence & Decay](explanation-confidence-and-decay.md) — how LLM-derived traits work
