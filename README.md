# Kai

MCP server that builds and serves a behavioral profile from observations. AI agents connect via Model Context Protocol to read your profile and submit new observations.

## What it does

Kai watches what you do (cron outputs, daily patterns, explicit preferences) and builds a living user profile: identity, behavioral traits, and preferences. Other AI tools can then ask Kai "who is this person?" and get a rich, evidence-based answer.

Core capabilities:
- **MCP Server** — Model Context Protocol server via stdio. 5 tools (`profile.read`, `profile.why`, `observe.submit`, `observe.batch`, `derive.trigger`) and 6 resources (`kai://profile/*`, `kai://system/health`)
- **Profile Engine** — identity, observations, traits, and preferences with full CRUD
- **Trait Derivation** — rule-based (early riser, tinkerer, consistent user) + LLM-based inference
- **Confidence Decay** — traits weaken over time unless reinforced, declared traits are immune
- **Provenance** — every trait has a chain of evidence. Ask "why?" and get the reasoning
- **Observation Collection** — SHA-256 dedup, cron schedule parsing, daily batch collection

## Install

Requires [Bun](https://bun.sh) runtime.

```bash
git clone https://github.com/hk1196320121-cmd/kai.git
cd kai
bun install
```

Run the CLI:

```bash
bun run src/cli/index.ts <command>
```

Or link globally:

```bash
bun link
kai <command>
```

## Quick start

```bash
# Interactive first-time profile setup
kai profile bootstrap

# View your profile
kai profile read

# Collect observations from cron outputs
kai observe daily

# Derive traits from collected observations
kai profile derive

# Ask why a trait has its value
kai profile why early_riser

# Correct a wrong trait
kai profile correct early_riser

# Apply time-based confidence decay
kai profile decay

# Start MCP server (for AI agent integration)
kai mcp serve
```

## CLI reference

### `kai profile`

| Command | Description |
|---------|-------------|
| `bootstrap` | Interactive cold start: build your initial profile through questions |
| `read` | Display current profile (identity, traits, observation count) |
| `read --json` | Output profile as JSON |
| `read --field <name>` | Show a specific identity field |
| `update --field <name> --value <val>` | Update an identity field |
| `derive` | Run rule-based and LLM trait derivation from observations |
| `why <dimension>` | Explain why a trait has its value (provenance chain) |
| `correct <dimension>` | Remove an incorrect trait and log the correction |
| `decay` | Apply confidence decay to stale traits |

### `kai observe`

| Command | Description |
|---------|-------------|
| `from-cron <file>` | Extract observations from a cron output markdown file |
| `daily` | Scan all Hermes cron outputs and collect new observations |

### `kai mcp`

| Command | Description |
|---------|-------------|
| `serve` | Start MCP server with stdio transport for AI agent integration |

#### MCP Tools

| Tool | Description |
|------|-------------|
| `profile.read` | Read profile in 4 scopes: identity, traits, summary, full |
| `profile.why` | Explain why a trait has its value (provenance chain) |
| `observe.submit` | Submit a single observation (rate-limited, deduped) |
| `observe.batch` | Submit multiple observations at once |
| `derive.trigger` | Trigger trait derivation (rules, LLM, or both) |

#### MCP Resources

| Resource | Description |
|----------|-------------|
| `kai://profile/identity` | Identity fields |
| `kai://profile/traits` | All behavioral traits |
| `kai://profile/traits/{dimension}` | Single trait by dimension |
| `kai://profile/observations/recent` | Recent observations |
| `kai://profile/summary` | Profile summary |
| `kai://system/health` | System health check |

## Architecture

```
src/
  cli/            Commander.js CLI (profile, observe, mcp subcommands)
  core/profile/   Profile engine, derivator, decay, provenance, collector
  mcp/            MCP server — handlers, resources, schema, stdio transport
  bridge/         Hermes bridge (file system reads for cron data)
  db/             SQLite client with WAL mode and schema migrations
  llm/            OpenAI-compatible LLM provider with transient-error retry
```

Data flows: **Hermes cron outputs** -> **Collector** (dedup) -> **Observations** (SQLite) -> **Derivator** (rules + LLM) -> **Traits** -> **Decay** (time-based confidence) -> **Provenance** (evidence chain). MCP clients connect via stdio to read profiles and submit observations.

Profile data is stored in `~/.kai/profile.db` (SQLite with WAL mode).

## Documentation

| Document | Type | Description |
|----------|------|-------------|
| [MCP Server Reference](docs/reference-mcp-server.md) | Reference | Complete API for all 5 tools and 6 resources |
| [Connect an AI Agent](docs/howto-connect-mcp-server.md) | How-to | Connect Claude Desktop, Cursor, or custom clients |
| [First Profile Tutorial](docs/tutorial-first-profile.md) | Tutorial | From zero to first derived trait in 5 minutes |
| [Confidence & Decay](docs/explanation-confidence-and-decay.md) | Explanation | Why two scales, why decay, how corrections persist |

## Development

```bash
bun install                # Install dependencies
bun test                   # Run tests
bun test --watch           # Watch mode
bun run typecheck          # Type-check with tsc
bun run lint               # Lint with Biome
bun run dev profile bootstrap  # Run CLI in dev mode
```

CI runs on every push and PR: typecheck, lint, test. Dependabot checks for dependency updates weekly.

## License

Private project.
