# How the Skill Compiler Works

The skill compiler turns Kai's 19 MCP tool schemas into SKILL.md files that Claude Code can discover as slash commands. This page explains the pipeline, the data structures, and the design trade-offs.

## The problem

Kai exposes 19 MCP tools (profile, observe, derive, work, idea, prompt, telemetry). To use them from Claude Code, you type tool names like `mcp__kai__profile_read` or navigate MCP resource URIs. This works but requires remembering exact tool IDs and their parameters.

Slash commands are easier: `/kai-profile`, `/kai-work`, `/kai-idea`. Claude Code discovers these from SKILL.md files in `~/.claude/skills/`. The skill compiler bridges the gap: it reads Kai's own Zod schemas, groups tools into domains, generates SKILL.md files with the right frontmatter, and writes them where Claude Code looks.

## The pipeline

```
Zod schemas (src/mcp/*-schema.ts)
  │
  ▼
compiler.ts — introspects schemas via z.toJSONSchema(), groups tools into 7 domains
  │
  ├─ templates.ts — generates SKILL.md markdown from domain configs
  │
  ├─ workflows/definitions.ts → CommandGenerator → slash commands in ~/.claude/commands/kai/
  │
  └─ hooks/ → hook scripts in ~/.claude/hooks/kai/
  │
  ▼
targets/claude-code.ts — writes to ~/.claude/skills/kai/ + commands/ + hooks/ + configures MCP + registers hooks
  │
  ▼
Claude Code discovers skills on next launch → slash commands + hooks active
```

## Domain mapping

The compiler maps each of the 19 MCP tools to one of 7 domains:

| Domain | Tools | Slash commands |
|--------|-------|---------------|
| derive | `derive.trigger` | `/kai-derive` |
| idea | `kai_idea_submit`, `kai_idea_plan`, `kai_plan_approve`, `kai_task_execute`, `kai_idea_pause`, `kai_replan` | `/kai-idea`, `/kai-plan`, `/kai-approve`, `/kai-execute`, `/kai-pause`, `/kai-replan` |
| observe | `observe.submit`, `observe.batch` | `/kai-observe`, `/kai-observe-batch` |
| profile | `profile.read`, `profile.why` | `/kai-profile`, `/kai-why` |
| prompt | `prompt.compile`, `prompt.champion`, `prompt.evolve` | `/kai-prompt`, `/kai-champion`, `/kai-evolve` |
| telemetry | `telemetry.query`, `telemetry.trace`, `telemetry.explain` | `/kai-telemetry`, `/kai-trace`, `/kai-explain` |
| work | `kai_work_recommend`, `kai_execution_status` | `/kai-work`, `/kai-status` |

The mapping is defined in `TOOL_DOMAIN_MAP` in `compiler.ts`. Adding a new MCP tool means adding one entry to this map.

## Schema introspection

The compiler uses Zod's `z.toJSONSchema()` API to convert each tool's input schema into a human-readable parameter description. This means the SKILL.md files always reflect the actual schema — if a parameter is added or renamed in the Zod schema, the next `kai skills install` picks it up automatically.

If `z.toJSONSchema()` fails on an unsupported type, the compiler falls back to listing parameter names only (no types or descriptions).

## Target adapter pattern

The compiler uses a `TargetAdapter` interface with a single implementation: `ClaudeCodeTarget`. The adapter handles:

- **Install paths**: `~/.claude/skills/kai/` (skills), `~/.claude/commands/kai/` (workflow commands), `~/.claude/hooks/kai/` (hook scripts)
- **MCP configuration**: reads and writes `~/.claude.json` to register the `kai` MCP server
- **Hook registration**: reads and writes `~/.claude/settings.json` to register SessionStart and PostToolUse hooks
- **Atomic writes**: uses `tmpfile + renameSync + chmodSync(0o600)` to avoid corrupting config files if the process crashes mid-write
- **Validation**: checks `manifest.json` existence, command files, hook scripts, and settings.json hook registration

Adding a new target (e.g., Cursor, Windsurf) means implementing the `TargetAdapter` interface with the correct install path and config file format. The compiler and templates don't change.

## Generated file structure

```
~/.claude/skills/kai/
  SKILL.md           ← master: lists all 19 commands, links to domains
  manifest.json      ← machine-readable: version, generated-at, domain→tools map
  derive/SKILL.md    ← derive.trigger tool, parameters, examples
  idea/SKILL.md      ← 6 orchestrator tools
  observe/SKILL.md   ← observe.submit, observe.batch
  profile/SKILL.md   ← profile.read, profile.why
  prompt/SKILL.md    ← prompt.compile, champion, evolve
  telemetry/SKILL.md ← telemetry.query, trace, explain
  work/SKILL.md      ← kai_work_recommend, execution_status

~/.claude/commands/kai/
  kai.md              ← /kai — behavioral dashboard
  kai-profile.md      ← /kai-profile — profile summary
  kai-observe.md      ← /kai-observe — submit observations
  kai-why.md          ← /kai-why — trait explanations
  kai-plan.md         ← /kai-plan — idea planning
  kai-status.md       ← /kai-status — execution status
  kai-reflect.md      ← /kai-reflect — profile reflection
  kai-evolve.md       ← /kai-evolve — prompt evolution

~/.claude/hooks/kai/
  kai-session-start.cjs  ← injects profile context into new sessions
  kai-auto-observe.cjs   ← detects tool usage patterns and submits observations
```

Each SKILL.md has YAML frontmatter with:
- `name`: the skill name (e.g., `kai-profile`)
- `description`: what the skill does and when it triggers
- `allowed-tools`: MCP tool names in `mcp__kai__<tool_id>` format, plus `Bash` and `Read`

## Trade-offs

**Generated files, not hand-written.** The compiler produces the entire skill surface from schemas. This means consistent formatting and automatic sync with the code, but you can't customize individual skill descriptions without editing the compiler maps.

**Domain grouping is static.** The `TOOL_DOMAIN_MAP` is a hard-coded lookup. Tools can't belong to multiple domains. This keeps things simple but means `/kai-work` and `/kai-status` share a single skill file even though they serve different purposes.

**No incremental updates.** `kai skills install --force` regenerates everything. There's no diff-based update for a single domain. For 19 tools across 7 domains, full regeneration is fast enough that incremental updates aren't worth the complexity.

## Related

- [How to Install and Manage Kai Skills](howto-skills.md) — step-by-step install/doctor/uninstall guide
- [CLI Reference](reference-cli.md) — full CLI command reference
- [MCP Server Reference](reference-mcp-server.md) — all 19 tools and 12 resources
