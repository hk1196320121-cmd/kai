# Kai — AI Behavioral Profile Engine

MCP server that builds and serves a behavioral profile from observations. AI agents connect via Model Context Protocol (stdio) to read user profiles, submit observations, derive behavioral traits, orchestrate idea-to-execution workflows, and optimize prompts through evolutionary A/B testing.

## Quick Reference

```bash
# Start MCP server (stdio transport)
kai mcp serve

# Start with custom database path
kai mcp serve --db /path/to/kai.db
```

## MCP Tools — Profile (5)

### profile.read

Read user profile data in different scopes.

**Parameters:**
- `scope` (required): `"identity"` | `"traits"` | `"summary"` | `"full"`
- `dimensions` (optional): `string[]` — filter traits to specific dimensions (only for `traits` scope)

**Returns:** JSON object matching the requested scope. `identity` scope omits internal fields (id, timestamps).

### profile.why

Explain why a trait has its current value. Returns the provenance chain — which observations contributed, which rules fired, and the reasoning.

**Parameters:**
- `dimension` (required): `string` — trait dimension name (e.g., `"early_riser"`, `"tinkerer"`)

**Returns:** Explanation object with trait value, confidence, contributing observations, and rule matches. Returns null for unknown dimensions.

### observe.submit

Submit a single observation about user behavior. Deduplicated via SHA-256 hash of content + tags + context. Rate-limited to 60 requests per minute.

**Parameters:**
- `text` (required): `string` (1–10240 chars) — observation content
- `sourceTool` (required): `string` (1–64 chars) — tool submitting the observation
- `confidence` (optional): `number` (0–1) — MCP-scale confidence. Converted to internal 1–10 scale automatically
- `tags` (optional): `string[]` — categorization labels
- `context` (optional): `string` — additional context for deduplication

**Returns:** Stored observation or duplicate notice.

### observe.batch

Submit multiple observations at once. Same dedup and schema as `observe.submit`.

**Parameters:**
- `sourceTool` (required): `string` — tool submitting observations
- `observations` (required): `Array<{ text, confidence?, tags?, context? }>` — max 50 items

**Returns:** Array of stored observations.

### derive.trigger

Trigger trait derivation from collected observations.

**Parameters:**
- `method` (required): `"rules"` | `"llm"` | `"both"` — derivation method
  - `rules`: Applies built-in pattern rules only
  - `llm`: Uses LLM inference (requires OPENAI_API_KEY or compatible endpoint)
  - `both`: Runs rules first, then LLM for additional traits

**Returns:** Array of newly derived traits with dimensions, values, and confidence scores.

## MCP Tools — Orchestrator (8)

### kai_idea_submit

Submit a new idea for planning and execution.

**Parameters:**
- `title` (required): `string` (1–200 chars) — idea title
- `description` (optional): `string` (1–5000 chars) — detailed description
- `domain` (optional): `"coding"` | `"writing"` | `"research"` | `"creative"` | `"management"` | `"general"` — idea domain (default: `general`)
- `priority` (optional): `"low"` | `"medium"` | `"high"` | `"critical"` — idea priority (default: `medium`)
- `deadline` (optional): `string` — ISO date deadline
- `workspace_id` (optional): `string` — existing workspace ID (auto-created if omitted)

**Returns:** Created idea with `id`, `title`, `status`, `createdAt`.

### kai_idea_plan

Decompose an idea into a plan of tasks using LLM-powered decomposition. The planner uses the user's behavioral profile to adapt scheduling (e.g., morning tasks for early risers).

**Parameters:**
- `idea_id` (required): `string` — ID from `kai_idea_submit`

**Returns:** Plan with array of planned tasks, each with `title`, `description`, `scheduledFor`, `agentHint`.

### kai_plan_approve

Approve a plan, scheduling its tasks for execution. Validates task field updates against an explicit allowlist.

**Parameters:**
- `idea_id` (required): `string` — idea whose plan to approve
- `task_modifications` (optional): `Array<{ task_id, action, field, value }>` — overrides for specific tasks (allowlist: title, prompt, cron_schedule, agent, type)

**Returns:** Approved tasks with scheduled times and dispatch status.

### kai_task_execute

Dispatch a specific task to an agent bridge for execution.

**Parameters:**
- `task_id` (required): `string` — task to execute

**Returns:** Execution result with `status`, `exitCode`, `output`.

### kai_idea_pause

Pause an active idea and all its pending tasks. Completed tasks are unaffected.

**Parameters:**
- `idea_id` (required): `string` — idea to pause

**Returns:** Updated idea with `status: "paused"`.

### kai_execution_status

Check execution status for all tasks in an idea.

**Parameters:**
- `idea_id` (required): `string` — idea to check
- `task_id` (optional): `string` — filter to specific task
- `feedback` (optional): `string` — user feedback (max 2000 chars, becomes profile observation)

**Returns:** Array of tasks with execution status, exit codes, and timestamps.

### kai_replan

Re-plan an idea after closed-loop feedback. Used when the closed-loop engine detects significant trait changes that warrant schedule adjustments.

**Parameters:**
- `idea_id` (required): `string` — idea to re-plan

**Returns:** New plan replacing the previous one, with updated tasks.

### kai_work_recommend

Get task recommendations based on the user's behavioral profile traits. Returns ranked templates with explanations for why each fits the user.

**Parameters:**
- `domain` (optional): `"coding"` | `"writing"` | `"research"` | `"creative"` | `"management"` | `"general"` — filter by domain (default: `general`)
- `limit` (optional): `number` (1–5) — number of recommendations (default: 3)

**Returns:** Array of recommendations with `title`, `domain`, `traitAlignment`, `explanation`, and `traitTargets`.

## MCP Tools — Prompt Genome (3)

### prompt.compile

Compile a prompt for a given task using the current genome and profile context. The compiler selects the best gene variants for each type (intent, contract, adapter, example, tone) and assembles them into a complete prompt.

**Parameters:**
- `task` (required): `"planner"` | `"derivator"` | `"observer"` — task to compile prompt for

**Returns:** Compiled prompt metadata with task, segment, gene count, cache status, and prompt length.

### prompt.champion

Get the current champion variant for a task and optional segment. Champions are the best-performing variants from tournament battles.

**Parameters:**
- `task` (required): `"planner"` | `"derivator"` | `"observer"` — task to get champion for
- `segment` (optional): `string` — segment ID (default: `"default"`)

**Returns:** Champion object with variant ID, model, win rate, battle count, and lock status. Returns `null` if no champion exists.

### prompt.evolve

Run evolutionary optimization for a task's prompt. Generates new variants via LLM mutations, runs pairwise tournament battles with LLM-as-judge, and promotes the winner as champion if it outperforms the current one.

**Parameters:**
- `task` (required): `"planner"` | `"derivator"` | `"observer"` — task to evolve
- `rounds` (optional): `number` — number of evolution rounds (default: 1)
- `auto_approve` (optional): `boolean` — auto-approve champion promotion (default: false)

**Returns:** Evolution result with rounds completed, battles run, champion promotion status, and variant IDs.

## MCP Tools — Telemetry (3)

### telemetry.query

Run a SQL query against telemetry views. Read-only — only `SELECT` statements are accepted. Queries are validated against a table allowlist (only `telemetry_*_v1` and `runtime_*` tables/views). Results are capped at 1000 rows when no `LIMIT` is specified. SQL injection is blocked via semicolon rejection, comma-join detection, UNION blocking, and table allowlist enforcement.

**Parameters:**
- `sql` (required): `string` (min 1 char) — SQL query to execute against telemetry views (SELECT only)

**Returns:** `{ rows: Record<string, unknown>[], count: number }` on success, or `{ error: "query_failed", message: string }` on failure.

**Allowed tables:** `telemetry_traces_v1`, `telemetry_spans_v1`, `telemetry_events_v1`, `telemetry_state_changes_v1`, `telemetry_errors_v1`, `runtime_traces`, `runtime_spans`, `runtime_events`, `runtime_state_changes`, `runtime_errors`.

### telemetry.trace

Retrieve the full causal chain for a trace — the trace itself, all spans, events, state changes, and errors. When errors are present, includes suggested actions based on similar past errors.

**Parameters:**
- `traceId` (required): `string` — trace ID to retrieve the full causal trace for

**Returns:** `{ trace, spans, events, stateChanges, errors, suggested_actions }` where `suggested_actions` contains up to 3 similar past errors with occurrence counts and last-seen timestamps. Returns `{ error: "trace_not_found", traceId }` when the trace ID does not exist.

### telemetry.explain

Ask a natural language question about recent telemetry. Returns an LLM-generated analysis with summary, relevant trace IDs, and evidence-backed insights. Rate-limited to 10 calls per hour. Results are cached for 5 minutes. Falls back to stats-only summary when no LLM API key is configured.

**Parameters:**
- `question` (required): `string` (min 1 char) — natural language question about recent telemetry

**Returns:** `{ summary: string, traces: string[], insights: Array<{ claim: string, evidence: string }> }`. Max 5 insights, summary under 200 words. When rate-limited: `{ summary: "Rate limit exceeded: 10 calls/hour. Try again later.", traces: [], insights: [] }`.

## MCP Resources (12)

Resources are read-only profile access endpoints. All return `application/json`.

| URI | Description |
|-----|-------------|
| `kai://profile/identity` | User identity fields |
| `kai://profile/traits` | All behavioral traits with confidence scores |
| `kai://profile/traits/{dimension}` | Single trait by dimension name |
| `kai://profile/observations/recent` | 50 most recent observations |
| `kai://profile/summary` | Profile summary: identity + top 5 traits by confidence |
| `kai://system/health` | Database integrity check + observation/trait counts |
| `kai://prompt/{task}` | Compiled prompt for a task (planner, derivator, observer) |
| `kai://prompt/champion/{task}` | Current champion variant for a task |
| `kai://prompt/evolution-history/{task}` | Champion promotion history for a task |
| `kai://telemetry/trace/{traceId}` | Full causal chain for a specific trace |
| `kai://telemetry/recent-errors` | Recent telemetry errors |
| `kai://telemetry/health` | Telemetry system health stats |

## CLI Commands

```bash
# Profile management
kai profile read                   # View profile
kai profile read --json            # JSON output
kai profile read --field <name>    # Single identity field
kai profile diff --last            # See profile changes since last cold start
kai profile update --field <name> --value <val>
kai profile derive                 # Derive traits from observations
kai profile why <dimension>        # Trait provenance
kai profile correct <dimension>    # Remove incorrect trait
kai profile decay                  # Apply confidence decay

# Cold start
kai work start                     # Interactive profile bootstrapping (10-question interview + git scan)

# Observation collection
kai observe from-cron <file>       # Extract from cron output file
kai observe daily                  # Scan all Hermes cron outputs

# MCP server
kai mcp serve                      # Start MCP server (stdio)
kai mcp serve --db <path>          # Custom database path

# Prompt genome
kai prompt gene list               # List all genes
kai prompt gene list --task planner --type intent  # Filter genes
kai prompt gene inspect <id>       # Show full gene details
kai prompt genome compile --task planner   # Compile prompt for planner
kai prompt genome show --task derivator    # Show genome details
kai prompt champion show --task planner    # Show current champion
kai prompt champion lock --task planner    # Lock champion (prevent rollback)
kai prompt champion rollback --task planner # Rollback to previous champion
kai prompt evolve --task planner --rounds 3  # Run 3 evolution rounds
kai prompt tournament results --task planner --last 5  # Recent tournaments

# Telemetry
kai telemetry health                   # Show telemetry health
kai telemetry query "SELECT ..."       # SQL query against telemetry views
kai telemetry trace <trace-id>         # Full causal chain
kai telemetry errors                   # Recent errors
kai telemetry explain "question"       # LLM-powered analysis

# Skills (generate SKILL.md files for Claude Code, Gemini CLI, or Hermes)
kai skills install                     # Generate skill files, workflow commands, and hooks (auto-detect platform)
kai skills install --force             # Overwrite existing skill files
kai skills install --target gemini-cli # Install for Gemini CLI instead of Claude Code
kai skills install --target all        # Install for all detected platforms
kai skills list                        # List installed skills and their tools (auto-detect platform)
kai skills list --target hermes        # List skills for a specific platform
kai skills doctor                      # Validate installed skills, commands, and hooks (all platforms)
kai skills doctor --fix                # Reinstall to fix issues
kai skills doctor --target claude-code # Check only Claude Code installation
kai skills uninstall                   # Remove skill files, commands, and hooks (all platforms)
kai skills uninstall --target gemini-cli # Remove only Gemini CLI installation

# Hooks (manage autopilot hooks for Claude Code)
kai hooks install                      # Install autopilot hooks (SessionStart, PostToolUse, Stop) into Claude Code settings
kai hooks uninstall                    # Remove Kai autopilot hooks from Claude Code settings
kai hooks status                       # Show current hook installation status (scripts and settings registration)

# Autopilot (session tracking and trait derivation)
kai autopilot status                   # Show autopilot session history and active session info
```

## Architecture

```
src/
  autopilot/        AutopilotManager — installs/uninstalls hooks, session tracking, shared derive module
    index.ts        AutopilotManager class (install, uninstall, status)
    types.ts        AutopilotSession, HookInput interfaces
    derive-shared.ts  Shared deriveFromRulesCore for Stop hook + Derivator
  cli/              Commander.js CLI (profile, observe, work, mcp, prompt, skills, hooks, autopilot, telemetry subcommands)
    work/            Work command modules — start, status, recommendations, git-scan, ui, types
    skills/          Skill compiler — generates SKILL.md files, workflow commands, and hooks
      compiler.ts    Introspects MCP tool schemas via Zod, builds skill configs
      templates.ts   Generates SKILL.md markdown from skill configs + intent-based triggers
      targets/       Pluggable target adapters (Claude Code, Gemini CLI, Hermes) + TargetRegistry
      commands/      CLI commands — install, list, doctor, uninstall
      hooks/         Hook script generators (SessionStart, PostToolUse, Stop)
        constants.ts   Shared constants (MIN_SCHEMA_VERSION, ALLOWED_TOOLS, BUSY_TIMEOUT_MS)
      workflows/     Workflow definitions + CommandGenerator (slash commands)
  mcp/              MCP server — handlers, resources, schema, stdio transport
    server.ts       Server creation and startup
    handlers.ts     Handler factory (re-exports from domain sub-files)
    handlers/       Domain-specific profile handlers
      profile.ts    Profile read + why handlers
      observe.ts    Single + batch observation submission handlers
      derive.ts     Derivation trigger handler
    orchestrator-handlers.ts  Orchestrator handler factory (re-exports from domain sub-files)
    orchestrator/   Domain-specific orchestrator handlers
      ideas.ts      Idea submit, plan, pause, replan handlers
      tasks.ts      Task execute, execution status handlers
      planning.ts   Plan approve handler
      utils.ts      Shared orchestrator handler utilities
    prompt-handlers.ts   3 prompt genome tool handlers (compile, champion, evolve)
    prompt-schema.ts     Zod schemas for prompt tools
    telemetry-handlers.ts  3 telemetry tool handlers (query, trace, explain)
    telemetry-resources.ts 3 telemetry resource endpoints (kai://telemetry/*)
    telemetry-schema.ts    Zod schemas for telemetry tools
    orchestrator-schema.ts    Zod schemas for orchestrator tools
    resources.ts    6 profile resource endpoints
    schema.ts       Zod input validation schemas (profile tools)
    utils.ts        textContent, withTrace, safeJsonParse, structured logging
  core/profile/     Profile engine core
    engine.ts       CRUD for identity, observations, traits, preferences; source precedence
    derivator.ts    Thin facade re-exporting rules + LLM derivation
    rules.ts        25 derivation rule definitions across 21 dimensions (with deriveFromValues)
    llm-derive.ts   LLM-based trait inference logic
    interview-questions.ts  10-question interview catalog with trait targets
    interview.ts    InterviewEngine — cold start interview flow with signal extraction
    provenance.ts   Trait provenance chain and correction tracking
    dedup.ts        SHA-256 deduplication (content + tags + context)
    decay.ts        Time-based confidence decay (declared traits immune)
    mcp-scale.ts    MCP (0–1) ↔ internal (1–10) confidence conversion
    collector.ts    Hermes cron output parsing and batch collection
    types.ts        Core type definitions
  core/orchestrator/  Idea-to-execution engine
    types.ts        Idea, PlannedTask, ExecutionResult types
    recommend.ts    Task recommendation engine — matches templates to profile traits
    templates.ts    Task template catalog (12 templates, 6 domains) with trait alignment scoring
    domain-resolver.ts  Resolves idea domain from interview answers and keyword heuristics
    store.ts        CRUD for ideas, tasks, execution results (SQLite)
    planner.ts      LLM-powered task decomposition with profile context
    profile-context.ts  Formats behavioral profile for planner prompts
    scheduler.ts    Profile-aware task scheduling
    dispatcher.ts   Task dispatch to agent bridges
    observer.ts     Converts execution results into profile observations
    clustering.ts   TF-IDF idea clustering from observation patterns
    closed-loop.ts  Detects trait changes and triggers re-planning
  core/prompt/      Prompt genome system
    types.ts        Gene, Genome, Variant, Segment, Tournament, Champion types
    gene-store.ts   CRUD for all 8 prompt genome tables (SQLite)
    prompt-compiler.ts  Assembly pipeline: select genes, match segments, build prompt
    segment-matcher.ts  Profile-to-segment matching algorithm
    prompt-evolver.ts   Mutation generation, champion promotion, rollback
    tournament-runner.ts  Pairwise variant battles with judge
    judge-engine.ts  LLM-as-judge evaluation with majority vote
  workspace/        Workspace system
    store.ts        CRUD for workspaces, tasks, and events with SQLite persistence
    event-bus.ts    Converts workspace state changes into profile observations
    types.ts        Workspace, Task, Event type definitions
  bridge/           Bridges
    agent-bridge.ts Agent bridge interface with Hermes file-based dispatch
  db/               SQLite client with WAL mode and schema migrations (v1–v9)
    client.ts       Database connection, migration runner, query helpers
    migrations/     Declarative migration registry + individual migration SQL
      index.ts      Sequential ordering + self-bumps cross-validation
      v1–v9.ts      Individual migration definitions
  llm/              OpenAI-compatible LLM provider with retry logic
```

Data flows:
- **Cold start path**: `kai work start` (10-question interview + git scan) → Derivator → Traits → Recommendations → Auto-execute (via kai_work_recommend MCP tool)
- **CLI path**: Hermes cron → Collector (dedup) → Observations (SQLite) → Derivator (rules + LLM) → Traits → Decay → Provenance
- **MCP path**: AI agent → stdio → MCP handlers → ProfileEngine → SQLite
- **Workspace path**: Workspace events → Event bus → Observations → Derivator → Traits
- **Orchestrator path**: Idea → Planner (LLM + profile context) → Tasks → Scheduler → Dispatcher → Agent bridge → Execution results → Observer → Profile observations → Closed-loop engine → Re-planning
- **Prompt genome path**: Genes → Genome → Compiler (profile-aware segments) → Variant → Tournament (A/B battle) → Judge (LLM-as-judge) → Champion promotion → Evolution loop
- **Telemetry path**: MCP tool call → withTrace wrapper → Trace + Spans + Events + State changes + Errors → SQLite telemetry tables → 30-day retention pruning. `telemetry.query`/`trace`/`explain` tools read back telemetry data
- **Skill compiler path**: MCP tool schemas (Zod) → Compiler → Skill configs → Templates → SKILL.md files → TargetRegistry → Target adapter (Claude Code / Gemini CLI / Hermes) → Platform-appropriate install directory + MCP config (JSON or YAML)
- **Workflow command path**: Workflow definitions → CommandGenerator (profile-aware trait baking) → Slash command .md files → `~/.claude/commands/kai/`
- **Hook path**: Hook generators (SessionStart, PostToolUse, Stop) → Hook scripts → `~/.claude/hooks/kai/` → Settings.json hook registration. Stop hook runs `deriveFromRulesCore` at session end to update traits
- **Autopilot path**: SessionStart → Create session marker in `autopilot_sessions` → PostToolUse captures tool_usage observations (allowlisted tools) → Stop → Close session + derive traits + prune old observations
- All paths share the same database (`~/.kai/kai.db`)

## Key Concepts

**Confidence scale**: MCP tools use 0–1 (continuous). Internal storage uses 1–10 (discrete). Conversion is automatic via `mcpToInternal()` / `internalToMcp()`.

**Deduplication**: Observations are hashed (SHA-256) using content + tags + context. Namespace format: `mcp:{tool}:{hash}`. Duplicate submissions return the existing observation.

**Trait derivation rules** (25 rules across 21 unique dimensions):

*MCP / cron rules (6):*
- `early_riser`: Matches cron patterns indicating morning activity
- `tinkerer`: Matches experimentation/tool usage patterns (accepts `mcp:` keys)
- `consistent_user`: Matches regular daily usage patterns
- `detail_oriented`: Matches MCP observations showing thorough, detailed behavior
- `scope_appetite`: Matches observations indicating willingness to explore broadly
- `risk_tolerance`: Matches observations showing risk-taking or cautious behavior

*Coldstart signal rules (7, deriveFromValues):*
- `planning_style` (coldstart:planning_style): From interview answer about planning approach
- `schedule_rhythm` (coldstart:schedule_rhythm): From interview answer about daily rhythm
- `preferred_output_shape` (coldstart:preferred_output_shape): From interview answer about output format
- `disliked_behavior` (coldstart:disliked_behavior): From interview answer about disliked behaviors
- `risk_tolerance` (coldstart:risk_tolerance): From interview answer about risk preferences
- `autonomy` (coldstart:autonomy): From interview answer about autonomy level
- `domain_context` (coldstart:domain_context): From interview answer about domain expertise

*Coldstart git/cron rules (7):*
- `detail_oriented` (coldstart:signal.detail_level): From self-assessed detail orientation
- `comm_style` (coldstart:signal.comm_style): From preferred communication style
- `domain_context` (coldstart:signal.domain): From stated domain expertise
- `preferred_output_shape` (coldstart:preferred_output_shape): From preferred output format
- `early_riser` (coldstart:git.commit_time_distribution): From git commit time patterns
- `detail_oriented` (coldstart:git.commit_message_length): From commit message thoroughness
- `scope_appetite` (coldstart:git.branch_pattern): From branch naming patterns

*Autopilot tool_usage rules (5):*
- `autonomy` (tool_usage:Bash): Direct execution signals — Bash usage indicates preference for hands-on action
- `detail_oriented` (tool_usage:Edit): Precise edit signals — Edit usage indicates careful, surgical modifications
- `exploratory` (tool_usage:Grep|Glob|WebSearch): Search/exploration signals — diverse search tool usage
- `code_focus` (tool_usage:Edit|Write|Read): Code editing signals — heavy use of code manipulation tools
- `planning_style` (tool_usage:TodoRead|TodoWrite): Structured planning signals — task management tool usage

**Corrections**: When a user corrects a trait via `profile.correct`, the correction is stored in a `corrections` table. Derivation skips corrected dimensions — the trait won't reappear after re-running `derive.trigger`.

**Decay**: Traits weaken over time unless reinforced by new observations. Declared traits (set directly by user) are immune to decay. Only available via CLI (`kai profile decay`), not MCP.

## Data Model

**Identity**: name, role, location, timezone, communication_style, interests (user-editable fields)

**Observation**: text, source (cron_output|session_log|user_stated|inferred|mcp|coldstart|workspace|execution_result|auto_observe|hook_error), type (behavior|preference|feedback|context|signal|tool_usage), confidence (1–10), tags, context, session_id (optional FK to autopilot_sessions), timestamp

**Trait**: dimension, value (0–1), confidence (1–10), source (declared|observed|inferred|cross-model), timestamp

**Correction**: dimension, reason, timestamp — prevents re-derivation of corrected traits

## Database

SQLite with WAL mode. Default path: `~/.kai/kai.db`. Schema versioned (v1–v9). Migrations run automatically on startup with transaction-safe DDL.

## Development

```bash
bun install          # Install dependencies
bun test             # Run tests (1200 across 129 files)
bun test --watch     # Watch mode
bun run typecheck    # Type-check with tsc --noEmit
bun run lint         # Lint with Biome
bun run dev <cmd>    # Run CLI in dev mode
```

Health stack: `bun run typecheck`, `bun run lint`, `bun run build`, `bun test`, `npx knip` (dead code). CI (GitHub Actions) runs all five checks on every push and PR.


<claude-mem-context>
# Memory Context

# claude-mem status

This project has no memory yet. The current session will seed it; subsequent sessions will receive auto-injected context for relevant past work.

Memory injection starts on your second session in a project.

`/learn-codebase` is available if the user wants to front-load the entire repo into memory in a single pass (~5 minutes on a typical repo, optional). Otherwise memory builds passively as work happens.

Live activity: http://localhost:37700
How it works: `/how-it-works`

This message disappears once the first observation lands.
</claude-mem-context>

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **kai** (4694 symbols, 10450 relationships, 214 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/kai/context` | Codebase overview, check index freshness |
| `gitnexus://repo/kai/clusters` | All functional areas |
| `gitnexus://repo/kai/processes` | All execution flows |
| `gitnexus://repo/kai/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
