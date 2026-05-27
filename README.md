# Kai

![CI](https://github.com/hk1196320121-cmd/kai/actions/workflows/ci.yml/badge.svg)
![npm](https://img.shields.io/npm/v/kai-profile)

MCP server that builds and serves a behavioral profile from observations. AI agents connect via Model Context Protocol to read your profile and submit new observations.

## What it does

Kai watches what you do (cron outputs, daily patterns, explicit preferences) and builds a living user profile: identity, behavioral traits, and preferences. Other AI tools can then ask Kai "who is this person?" and get a rich, evidence-based answer.

Core capabilities:
- **MCP Server** — Model Context Protocol server via stdio. 19 tools (5 profile + 8 orchestrator + 3 prompt + 3 telemetry) and 12 resources (`kai://profile/*`, `kai://prompt/*`, `kai://telemetry/*`, `kai://system/health`)
- **Orchestrator** — idea-to-execution engine with LLM-powered planning, scheduling, dispatching, observation, and closed-loop re-planning
- **Prompt Genome** — evolutionary prompt optimization with genes, genomes, tournaments, and LLM-as-judge. Prompts improve over time through automated A/B testing
- **Cold Start** — `kai work start` bootstraps a profile from a 10-question interview + git history scan, with task recommendations and auto-execution
- **Profile Engine** — identity, observations, traits, and preferences with full CRUD
- **Trait Derivation** — 20 rules across 16 dimensions + LLM-based inference, with source precedence protection
- **Workspace System** — CRUD for workspaces, tasks, and events with event-driven observation collection
- **Confidence Decay** — traits weaken over time unless reinforced, declared traits are immune
- **Provenance** — every trait has a chain of evidence. Ask "why?" and get the reasoning
- **Observation Collection** — SHA-256 dedup, cron schedule parsing, daily batch collection
- **Flight Recorder** — full causal chain telemetry tracing every MCP request through derivation, orchestration, and prompt genome. SQL query interface, LLM-powered explain, 30-day retention

## Install

Requires [Bun](https://bun.sh) runtime.

```bash
bunx kai-profile
```

Or install globally:

```bash
bun add -g kai-profile
kai <command>
```

Or clone for development:

```bash
git clone https://github.com/hk1196320121-cmd/kai.git
cd kai
bun install
```

## Quick start

```bash
# Bootstrap your profile from questions + git history
kai work start

# View your profile
kai profile read

# See how your profile changed since last cold start
kai profile diff --last

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
| `diff --last` | See how your profile changed since the last cold start |
| `read` | Display current profile (identity, traits, observation count) |
| `read --json` | Output profile as JSON |
| `read --field <name>` | Show a specific identity field |
| `update --field <name> --value <val>` | Update an identity field |
| `derive` | Run rule-based and LLM trait derivation from observations |
| `why <dimension>` | Explain why a trait has its value (provenance chain) |
| `correct <dimension>` | Remove an incorrect trait and log the correction |
| `decay` | Apply confidence decay to stale traits |

### `kai work`

| Command | Description |
|---------|-------------|
| `start` | Interactive cold start: 10-question interview + git history scan, recommendations, and auto-execution |

### `kai observe`

| Command | Description |
|---------|-------------|
| `from-cron <file>` | Extract observations from a cron output markdown file |
| `daily` | Scan all Hermes cron outputs and collect new observations |

### `kai prompt`

| Command | Description |
|---------|-------------|
| `prompt gene list [--task T] [--type T] [--json]` | List genes with optional filtering |
| `prompt gene inspect <gene-id>` | Show full gene details as JSON |
| `prompt genome compile --task <task> [--json]` | Compile prompt for a task |
| `prompt genome show --task <task>` | Show genome details as JSON |
| `prompt champion show --task <task> [--segment S] [--all-segments]` | Show champion info |
| `prompt champion lock --task <task> [--segment S]` | Lock current champion |
| `prompt champion rollback --task <task> [--segment S]` | Rollback to previous champion |
| `prompt evolve --task <task> [--rounds N] [--segment S] [--model M] [--auto]` | Run evolution with tournaments |
| `prompt tournament results --task <task> [--last N]` | Show tournament history |

### `kai telemetry`

| Command | Description |
|---------|-------------|
| `health` | Show telemetry system health (trace/error counts, retention status) |
| `query <sql>` | Run SQL query against telemetry views (read-only, table allowlist) |
| `trace <trace-id>` | Show full causal chain for a trace with suggested actions |
| `errors` | Show recent telemetry errors |
| `explain [question]` | Natural language telemetry analysis (LLM-powered, rate-limited) |

### `kai skills`

| Command | Description |
|---------|-------------|
| `install [--force]` | Generate SKILL.md files for Claude Code from Kai's MCP tool schemas |
| `list` | List installed skills and their associated MCP tools |
| `doctor [--fix]` | Validate installed skills against current schemas; `--fix` reinstalls |
| `uninstall` | Remove generated skill files and MCP configuration |

### `kai mcp`

| Command | Description |
|---------|-------------|
| `serve` | Start MCP server with stdio transport for AI agent integration |

#### MCP Tools — Profile (5)

| Tool | Description |
|------|-------------|
| `profile.read` | Read profile in 4 scopes: identity, traits, summary, full |
| `profile.why` | Explain why a trait has its value (provenance chain) |
| `observe.submit` | Submit a single observation (rate-limited, deduped) |
| `observe.batch` | Submit multiple observations at once |
| `derive.trigger` | Trigger trait derivation (rules, LLM, or both) |

#### MCP Tools — Orchestrator (8)

| Tool | Description |
|------|-------------|
| `kai_idea_submit` | Submit a new idea for planning |
| `kai_idea_plan` | Decompose an idea into tasks using LLM |
| `kai_plan_approve` | Approve and schedule a plan |
| `kai_task_execute` | Dispatch a task to an agent bridge |
| `kai_idea_pause` | Pause an active idea and its tasks |
| `kai_execution_status` | Check execution status for an idea |
| `kai_replan` | Re-plan an idea (after closed-loop feedback) |
| `kai_work_recommend` | Get task recommendations based on profile traits |

#### MCP Tools — Telemetry (3)

| Tool | Description |
|------|-------------|
| `telemetry.query` | Run SQL query against telemetry views (read-only, table allowlist) |
| `telemetry.trace` | Show full causal chain for a trace with suggested actions |
| `telemetry.explain` | Natural language telemetry analysis (LLM-powered, rate-limited 10/hour) |

#### MCP Resources

| Resource | Description |
|----------|-------------|
| `kai://profile/identity` | Identity fields |
| `kai://profile/traits` | All behavioral traits |
| `kai://profile/traits/{dimension}` | Single trait by dimension |
| `kai://profile/observations/recent` | Recent observations |
| `kai://profile/summary` | Profile summary |
| `kai://system/health` | System health check |
| `kai://telemetry/trace/{traceId}` | Full causal chain for a specific trace |
| `kai://telemetry/recent-errors` | Recent telemetry errors |
| `kai://telemetry/health` | Telemetry system health stats |
| `kai://prompt/{task}` | Compiled prompt for a task (planner, derivator, observer) |
| `kai://prompt/champion/{task}` | Current champion variant for a task |
| `kai://prompt/evolution-history/{task}` | Champion promotion history |

## Architecture

```
src/
  cli/            Commander.js CLI (profile, observe, work, mcp, prompt, skills, telemetry subcommands)
    cli/renderers/   Typed output renderers for consistent CLI formatting
    cli/work/        Work command modules (start, status, recommendations, git-scan, ui, types)
    cli/skills/      Skill compiler — generates SKILL.md files from MCP tool schemas (compiler, templates, targets, commands)
  core/profile/   Profile engine, derivator, decay, provenance, collector
  core/orchestrator/  Idea-to-execution engine (planner, scheduler, dispatcher, observer, clustering, closed-loop)
  core/prompt/    Prompt genome system (gene-store, compiler, evolver, tournament-runner, judge-engine, segment-matcher)
  core/telemetry/ Flight recorder — store, recorder, stats, explain, sanitizer, types
  workspace/      Workspace/task/event CRUD + event bus for observation collection
  mcp/            MCP server — handlers, resources, schema, stdio transport
  bridge/         Hermes bridge (file system reads) + agent bridge (task dispatch)
  db/             SQLite client with WAL mode and schema migrations (declarative registry in db/migrations/)
  llm/            OpenAI-compatible LLM provider with transient-error retry
dist/              Compiled output (tsc), created by bun run build
```

Data flows: **Cold start** (`kai work start`) -> **Observations** -> **Derivator** (rules + LLM) -> **Traits**. **Hermes cron outputs** -> **Collector** (dedup) -> **Observations** -> **Derivator** -> **Traits** -> **Decay** (time-based confidence) -> **Provenance** (evidence chain). **Workspace events** -> **Event bus** -> **Observations**. **Orchestrator**: Idea -> Planner (LLM) -> Tasks -> Scheduler -> Dispatcher -> Agent bridge -> Observer -> Profile updates -> Closed-loop re-planning. **Prompt Genome**: Genes -> Genome -> Compiler (profile-aware segments) -> Variants -> Tournament (A/B) -> Judge (LLM) -> Champion promotion -> Evolution loop. **Telemetry**: Every MCP tool call gets a trace with spans, events, state changes, and errors. Traces flow through derivation, orchestration, and prompt genome operations. 30-day retention with automatic pruning. MCP clients connect via stdio to read profiles, submit observations, orchestrate tasks, compile/evolve prompts, and query telemetry.

Profile data is stored in `~/.kai/kai.db` (SQLite with WAL mode).

## Documentation

| Document | Type | Description |
|----------|------|-------------|
| [AGENTS.md](AGENTS.md) | Reference | Quick reference for AI agents connecting to Kai |
| [MCP Server Reference](docs/reference-mcp-server.md) | Reference | Complete API for all 19 tools and 12 resources |
| [Connect an AI Agent](docs/howto-connect-mcp-server.md) | How-to | Connect Claude Desktop, Cursor, or custom clients |
| [First Profile Tutorial](docs/tutorial-first-profile.md) | Tutorial | From zero to first derived trait in 5 minutes |
| [Cold Start Tutorial](docs/tutorial-cold-start.md) | Tutorial | Build a profile from 10-question interview + git history in 5 minutes |
| [Interview & Recommendations Tutorial](docs/tutorial-cold-start-recommendations.md) | Tutorial | Full interview → recommendations → auto-execute walkthrough |
| [How to Use Cold Start](docs/howto-cold-start.md) | How-to | Re-running cold start, editing traits, diff, troubleshooting |
| [How to Get Task Recommendations](docs/howto-task-recommendations.md) | How-to | Using kai_work_recommend MCP tool and CLI recommendation workflow |
| [How to Manage Workspaces](docs/howto-workspace.md) | How-to | Listing, tracking, and understanding workspaces and tasks |
| [How Source Precedence Works](docs/howto-source-precedence.md) | How-to | Protecting explicit traits from derivation overwrites |
| [How to Use the Orchestrator](docs/howto-orchestrator.md) | How-to | Submitting ideas, approving plans, executing tasks, re-planning |
| [How to Run Prompt Evolution](docs/howto-prompt-evolution.md) | How-to | Running evolution rounds, managing champions, troubleshooting |
| [Confidence & Decay](docs/explanation-confidence-and-decay.md) | Explanation | Why two scales, why decay, how corrections persist |
| [How the Prompt Genome Works](docs/explanation-prompt-genome.md) | Explanation | Genes, segments, tournaments, judge criteria, design trade-offs |
| [Event Bus](docs/explanation-event-bus.md) | Explanation | How workspace events become profile observations |
| [How the Orchestrator Works](docs/explanation-orchestrator.md) | Explanation | Profile-aware planning, closed loop, clustering, design trade-offs |
| [How Recommendation Feedback Works](docs/explanation-recommendation-feedback.md) | Explanation | How rejected recommendations adjust trait confidence |
| [Orchestrator Tutorial](docs/tutorial-first-idea.md) | Tutorial | From idea submission to execution and profile feedback in 10 minutes |
| [CLI Reference](docs/reference-cli.md) | Reference | All CLI commands, flags, options, and environment variables |
| [Database Schema Reference](docs/reference-database.md) | Reference | Tables, columns, constraints, indexes, migration history |
| [How to Configure Kai](docs/howto-configure.md) | How-to | Environment variables, LLM setup, database path, Hermes integration |
| [How to Use Telemetry](docs/howto-telemetry.md) | How-to | Debug failures, monitor performance, query trace data |
| [How the Flight Recorder Works](docs/explanation-telemetry.md) | Explanation | Trace lifecycle, deferred writes, sanitizer design, trade-offs |
| [How CLI Output Rendering Works](docs/explanation-cli-renderers.md) | Explanation | Format primitives, typed renderers, color policy, ANSI-aware alignment |
| [How the Work Command Modules Work](docs/explanation-work-modules.md) | Explanation | PhaseResult control flow, cooperative SIGINT cancellation, module responsibilities |
| [How to Install and Manage Kai Skills](docs/howto-skills.md) | How-to | Install, validate, update, and remove generated skill files |
| [How the Skill Compiler Works](docs/explanation-skill-compiler.md) | Explanation | Zod schema introspection, domain mapping, target adapter pattern, trade-offs |

## Development

```bash
bun install                # Install dependencies
bun run build              # Compile TypeScript to dist/
bun test                   # Run tests
bun test --watch           # Watch mode
bun run typecheck          # Type-check with tsc
bun run lint               # Lint with Biome
bun run dev profile bootstrap  # Run CLI in dev mode
```

CI runs on every push and PR: typecheck, lint, build, test. Dependabot checks for dependency updates weekly.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and workflow.

## License

Private project.
