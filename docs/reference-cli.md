# CLI Reference

Complete reference for all Kai CLI commands, flags, and options.

## Global options

| Option | Description |
|--------|-------------|
| `--version` | Print version |
| `-h, --help` | Print help |

## `kai profile`

Manage your behavioral profile: identity, traits, observations, and corrections.

### `kai profile read`

Display your current profile.

```bash
kai profile read                # Human-readable output
kai profile read --json         # JSON output
kai profile read --field name   # Single identity field
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--field <name>` | Show a specific identity field (e.g., `name`, `role`, `goals`) |

### `kai profile update`

Update a single identity field.

```bash
kai profile update --field name --value "Ada"
```

| Flag | Required | Description |
|------|----------|-------------|
| `--field <name>` | Yes | Field to update |
| `--value <value>` | Yes | New value |

### `kai profile derive`

Derive behavioral traits from collected observations. Runs rule-based derivation (13 rules across 9 dimensions). LLM derivation is available via the MCP tool `derive.trigger` with `method: "llm"`.

```bash
kai profile derive
```

No flags. Outputs the number of newly derived traits.

### `kai profile why`

Explain why a trait has its current value. Shows the provenance chain: contributing observations and matched rules.

```bash
kai profile why early_riser
```

| Argument | Required | Description |
|----------|----------|-------------|
| `<dimension>` | Yes | Trait dimension name (e.g., `early_riser`, `tinkerer`, `detail_oriented`) |

### `kai profile correct`

Remove an incorrect trait and record a permanent correction. The trait won't reappear after re-running `derive`.

```bash
kai profile correct early_riser
```

| Argument | Required | Description |
|----------|----------|-------------|
| `<dimension>` | Yes | Trait to correct |

### `kai profile decay`

Apply time-based confidence decay to observed and inferred traits. Declared traits are immune.

```bash
kai profile decay
```

No flags. Outputs the number of traits decayed and skipped.

### `kai profile diff`

Compare your current profile against a snapshot from cold start.

```bash
kai profile diff --last
```

| Flag | Description |
|------|-------------|
| `--last` | Compare against the most recent cold start snapshot |

### `kai profile bootstrap` (deprecated)

Legacy profile bootstrapping. Use `kai work start` instead.

## `kai work`

Workspace and cold start management.

### `kai work start`

Interactive cold start: 4 questions + git history scan with preview/edit/confirm.

```bash
kai work start
```

No flags. Interactive flow:

1. Identity setup (name, role) — only on first run
2. Git history scan (last 30 days of commits)
3. 4 questions about your current work
4. Preview derived traits
5. Confirm (`Y`), edit (`E`), or restart (`R`)

### `kai work status`

Show detailed status for all active workspaces.

```bash
kai work status
```

No flags. Displays workspace name, status, task counts, event counts, and creation date.

### `kai work list`

List all workspaces (active and inactive).

```bash
kai work list
```

No flags. Active workspaces show a filled dot (`●`), inactive ones show an empty dot (`○`).

## `kai observe`

Collect behavioral observations from external sources.

### `kai observe from-cron`

Extract observations from a single cron output markdown file.

```bash
kai observe from-cron ~/cron-outputs/report.md
```

| Argument | Required | Description |
|----------|----------|-------------|
| `<file>` | Yes | Path to a `.md` cron output file |

Only `.md` files are supported.

### `kai observe daily`

Scan all Hermes cron outputs and collect new observations.

```bash
kai observe daily
```

No flags. Scans `~/.hermes/cron/` (or `$HERMES_HOME/cron/`) for markdown files.

## `kai mcp`

MCP server management.

### `kai mcp serve`

Start the MCP server with stdio transport.

```bash
kai mcp serve                  # Default database: $KAI_DB or ~/.kai/kai.db
kai mcp serve --db /path/db    # Custom database path
```

| Flag | Description |
|------|-------------|
| `--db <path>` | Custom database path (default: `$KAI_DB` or `~/.kai/kai.db`) |

The server reads JSON-RPC from stdin and writes to stdout. Structured logs go to stderr in JSON-line format.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KAI_DB` | `~/.kai/kai.db` | Database file path |
| `HERMES_HOME` | `~/.hermes` | Hermes home directory for cron output scanning |
| `LLM_API_KEY` | (empty) | API key for LLM calls (OpenAI-compatible) |
| `LLM_BASE_URL` | `http://localhost:11434/v1` | LLM API endpoint |
| `LLM_MODEL` | `gpt-4o-mini` | Model name for LLM calls |

See [How to Configure Kai](howto-configure.md) for setup instructions.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (file not found, invalid input, database error) |

## Related

- [MCP Server Reference](reference-mcp-server.md) — complete API for all 12 tools and 6 resources
- [How to Configure Kai](howto-configure.md) — environment variables and LLM setup
- [Database Schema Reference](reference-database.md) — tables, migrations, and data model
