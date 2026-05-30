# CLI Reference

Complete reference for all Kai CLI commands, flags, and options.

## Global options

| Option | Description |
|--------|-------------|
| `--version` | Print version |
| `--no-color` | Disable colored output. Also disabled when `NO_COLOR` env var is set or stdout is not a TTY |
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

Interactive cold start: 10-question interview + git history scan with task recommendations and auto-execution.

```bash
kai work start
```

No flags. Interactive flow:

1. Identity setup (name, role) — only on first run
2. Git history scan (last 30 days of commits)
3. 10-question interview about your work style and preferences
4. Task recommendations matched to your profile
5. Approve all, pick one, or skip recommendations

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

No flags. Active workspaces show a filled dot (`●`), inactive ones show an empty dot (`○`). Each workspace shows task progress (completed/total).

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

## `kai telemetry`

Flight recorder telemetry: query traces, inspect errors, and analyze performance.

### `kai telemetry health`

Show telemetry system health: trace and error counts, retention status.

```bash
kai telemetry health
```

No flags. Outputs total traces, error count, error rate, and retention pruning status.

### `kai telemetry query`

Run a SQL query against telemetry views. Read-only with table allowlist enforcement.

```bash
kai telemetry query "SELECT * FROM runtime_traces LIMIT 10"
```

| Argument | Required | Description |
|----------|----------|-------------|
| `<sql>` | Yes | SQL query (must start with SELECT, only telemetry tables allowed) |

Allowed tables: `telemetry_traces_v1`, `telemetry_spans_v1`, `telemetry_events_v1`, `telemetry_state_changes_v1`, `telemetry_errors_v1`, `runtime_traces`, `runtime_spans`, `runtime_events`, `runtime_state_changes`, `runtime_errors`. Results capped at 1000 rows.

### `kai telemetry trace`

Show the full causal chain for a trace: spans, events, state changes, errors, and suggested actions.

```bash
kai telemetry trace <trace-id>
```

| Argument | Required | Description |
|----------|----------|-------------|
| `<trace-id>` | Yes | Trace ID to inspect |

Outputs spans sorted by start time, nested events and state changes per span, errors with recoverability, and suggested actions for failures.

### `kai telemetry errors`

Show recent telemetry errors.

```bash
kai telemetry errors
```

No flags. Outputs the 20 most recent errors with type, message, recoverability, and timestamp.

### `kai telemetry explain`

Natural language analysis of telemetry data. LLM-powered with rate limiting (10 calls/hour).

```bash
kai telemetry explain "What's causing the most errors?"
```

| Argument | Required | Description |
|----------|----------|-------------|
| `<question>` | No | Question about telemetry data (uses stats-only fallback if omitted or no LLM key) |

Falls back to a stats summary when no LLM API key is configured. Caches results for 5 minutes.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KAI_DB` | `~/.kai/kai.db` | Database file path |
| `HERMES_HOME` | `~/.hermes` | Hermes home directory for cron output scanning |
| `LLM_API_KEY` | (empty) | API key for LLM calls (OpenAI-compatible) |
| `LLM_BASE_URL` | `http://localhost:11434/v1` | LLM API endpoint |
| `LLM_MODEL` | `gpt-4o-mini` | Model name for LLM calls |
| `KAI_TELEMETRY_RETENTION_DAYS` | `30` | Days to retain telemetry data before automatic pruning |
| `NO_COLOR` | (unset) | Disable colored output when set to any value |

See [How to Configure Kai](howto-configure.md) for setup instructions.

## `kai prompt`

Manage prompt genomes, genes, champions, and evolution. The prompt genome system optimizes LLM prompts through evolutionary A/B testing.

### `kai prompt gene list`

List genes with optional filtering by task and type.

```bash
kai prompt gene list                           # All genes
kai prompt gene list --task planner            # Genes for planner task
kai prompt gene list --type intent             # Genes of type intent
kai prompt gene list --task planner --json     # JSON output
```

| Flag | Required | Description |
|------|----------|-------------|
| `--task <task>` | No | Filter by task: `planner`, `derivator`, `observer` |
| `--type <type>` | No | Filter by gene type: `intent`, `contract`, `adapter`, `example`, `tone` |
| `--json` | No | Output as JSON |

### `kai prompt gene inspect`

Show full gene details as JSON.

```bash
kai prompt gene inspect <gene-id>
```

| Argument | Required | Description |
|----------|----------|-------------|
| `<gene-id>` | Yes | Gene ID to inspect |

### `kai prompt genome compile`

Compile a prompt for a task using the current genome. Selects the best gene variants and assembles them into a complete prompt.

```bash
kai prompt genome compile --task planner
kai prompt genome compile --task derivator --json
```

| Flag | Required | Description |
|------|----------|-------------|
| `--task <task>` | Yes | Task to compile for: `planner`, `derivator`, `observer` |
| `--json` | No | Output as JSON |

Outputs genome ID, segment, variant, gene count, cache status, and the compiled prompt text.

### `kai prompt genome show`

Show genome details as JSON for a task.

```bash
kai prompt genome show --task planner
```

| Flag | Required | Description |
|------|----------|-------------|
| `--task <task>` | Yes | Task to show genome for |

### `kai prompt champion show`

Show champion info for a task. Champions are the best-performing variants from tournament battles.

```bash
kai prompt champion show --task planner
kai prompt champion show --task planner --segment default
kai prompt champion show --task planner --all-segments
```

| Flag | Required | Description |
|------|----------|-------------|
| `--task <task>` | Yes | Task to show champion for |
| `--segment <id>` | No | Segment ID (default: `default`) |
| `--all-segments` | No | Show champions across all segments |

Outputs variant ID, model, win rate, battle count, promotion date, and lock status.

### `kai prompt champion lock`

Lock the current champion, preventing rollback. Use when you want to pin a known-good variant.

```bash
kai prompt champion lock --task planner
kai prompt champion lock --task planner --segment default
```

| Flag | Required | Description |
|------|----------|-------------|
| `--task <task>` | Yes | Task to lock champion for |
| `--segment <id>` | No | Segment ID (default: `default`) |

### `kai prompt champion rollback`

Rollback to the previous champion variant. Fails if the current champion is locked or there is no previous champion.

```bash
kai prompt champion rollback --task planner
```

| Flag | Required | Description |
|------|----------|-------------|
| `--task <task>` | Yes | Task to rollback champion for |
| `--segment <id>` | No | Segment ID (default: `default`) |

### `kai prompt evolve`

Run evolutionary optimization for a task's prompt. Generates new variants via LLM mutations, runs tournament battles with LLM-as-judge, and promotes the winner as champion if it outperforms the current one.

```bash
kai prompt evolve --task planner
kai prompt evolve --task planner --rounds 3
kai prompt evolve --task derivator --model gpt-4o --auto
```

| Flag | Required | Description |
|------|----------|-------------|
| `--task <task>` | Yes | Task to evolve |
| `--rounds <n>` | No | Number of evolution rounds (default: 1) |
| `--segment <id>` | No | Segment ID (default: `default`) |
| `--model <model>` | No | LLM model to use (default: `gpt-4o-mini`) |
| `--auto` | No | Auto-approve champion promotion |

Outputs battles run, champion promotion status, and new/previous variant IDs.

### `kai prompt tournament results`

Show tournament battle history for a task.

```bash
kai prompt tournament results --task planner
kai prompt tournament results --task planner --last 5
```

| Flag | Required | Description |
|------|----------|-------------|
| `--task <task>` | Yes | Task to show tournaments for |
| `--last <n>` | No | Number of recent tournaments (default: 10) |

## `kai hooks`

Manage Kai autopilot hooks for Claude Code. Hooks run automatically at session start, after tool use, and at session stop.

### `kai hooks install`

Install autopilot hooks into Claude Code settings. Writes three hook scripts (`kai-session-start.cjs`, `kai-auto-observe.cjs`, `kai-stop.cjs`) and merges hook registrations into `~/.claude/settings.json`.

```bash
kai hooks install
```

| Flag | Required | Description |
|------|----------|-------------|
| `--hooks-dir <dir>` | No | Hook scripts directory (default: `~/.claude/hooks/kai`) |
| `--settings <path>` | No | Claude Code settings.json path (default: `~/.claude/settings.json`) |

### `kai hooks uninstall`

Remove Kai autopilot hooks from Claude Code settings. Removes hook registrations from `~/.claude/settings.json`.

```bash
kai hooks uninstall
```

| Flag | Required | Description |
|------|----------|-------------|
| `--settings <path>` | No | Claude Code settings.json path (default: `~/.claude/settings.json`) |

### `kai hooks status`

Show current hook installation status. Checks which hook scripts exist on disk and which hook registrations appear in settings.json.

```bash
kai hooks status
```

| Flag | Required | Description |
|------|----------|-------------|
| `--hooks-dir <dir>` | No | Hook scripts directory (default: `~/.claude/hooks/kai`) |
| `--settings <path>` | No | Claude Code settings.json path (default: `~/.claude/settings.json`) |

## `kai autopilot`

View autopilot session history and status.

### `kai autopilot status`

Show autopilot session history and active session information. Displays session IDs, observation counts, traits derived, derivation status, and session duration.

```bash
kai autopilot status
```

| Flag | Required | Description |
|------|----------|-------------|
| `--db <path>` | No | Kai database path (default: `~/.kai/kai.db`) |

## `kai skills`

Generate, validate, and manage SKILL.md files for AI coding tools. Supports multiple platforms: Claude Code (default), Gemini CLI, and Hermes.

### `kai skills install`

Generate SKILL.md files, workflow commands, and hooks for an AI coding tool. Auto-detects installed platforms, or installs for a specific target.

```bash
kai skills install                     # Auto-detect platform and install
kai skills install --force             # Overwrite existing files
kai skills install --target gemini-cli # Install for Gemini CLI
kai skills install --target hermes     # Install for Hermes
kai skills install --target all        # Install for all detected platforms
kai skills install --configure-mcp     # Also configure MCP server entry
```

| Flag | Required | Description |
|------|----------|-------------|
| `--force` | No | Overwrite existing skill files |
| `--target <platform>` | No | Target platform: `claude-code`, `gemini-cli`, `hermes`, or `all` (default: auto-detect) |
| `--configure-mcp` | No | Register or update the `kai` MCP server entry in the target's config file |

### `kai skills list`

List installed skills and their associated MCP tools. Shows platform, version, and which domains are installed.

```bash
kai skills list                        # Auto-detect platform and list
kai skills list --target claude-code   # List Claude Code installation
kai skills list --target all           # List all platform installations
```

| Flag | Required | Description |
|------|----------|-------------|
| `--target <platform>` | No | Filter by platform: `claude-code`, `gemini-cli`, `hermes`, or `all` (default: auto-detect) |

### `kai skills doctor`

Validate the health of an installed skill set. Checks manifest, skill files, workflow commands, hook scripts, and MCP configuration.

```bash
kai skills doctor                      # Check all detected platforms
kai skills doctor --fix                # Reinstall to fix issues
kai skills doctor --target gemini-cli  # Check only Gemini CLI
```

| Flag | Required | Description |
|------|----------|-------------|
| `--fix` | No | Reinstall skill files to fix detected issues |
| `--target <platform>` | No | Check specific platform: `claude-code`, `gemini-cli`, `hermes`, or `all` (default: all) |

### `kai skills uninstall`

Remove generated skill files, workflow commands, hook scripts, and MCP configuration. Prompts for confirmation unless `--force` is passed.

```bash
kai skills uninstall                   # Remove all platform installations
kai skills uninstall --force           # Skip confirmation prompt
kai skills uninstall --target hermes   # Remove only Hermes installation
```

| Flag | Required | Description |
|------|----------|-------------|
| `--force` | No | Skip confirmation prompt |
| `--target <platform>` | No | Remove specific platform: `claude-code`, `gemini-cli`, `hermes`, or `all` (default: all) |

### Platform detection

All `kai skills` commands auto-detect installed AI tools on the current machine. Detection checks for platform-specific home directories and configuration files. Use `--target` to override auto-detection when multiple platforms are installed.

Supported platforms:
- **claude-code** — Installs to `~/.claude/skills/kai/`, configures MCP in `~/.claude.json` (JSON), registers hooks in `~/.claude/settings.json`
- **gemini-cli** — Installs to `~/.gemini/skills/kai/`, configures MCP in `~/.gemini/settings.json` (JSON)
- **hermes** — Installs to `~/.hermes/skills/kai/`, configures MCP via YAML config

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (file not found, invalid input, database error) |

## Related

- [MCP Server Reference](reference-mcp-server.md) — complete API for all 19 tools and 12 resources
- [How to Configure Kai](howto-configure.md) — environment variables and LLM setup
- [Database Schema Reference](reference-database.md) — tables, migrations, and data model
