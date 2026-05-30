# How Hooks and Workflow Commands Work

Kai's hooks and workflow commands form an automation layer on top of the skill compiler. This page explains why they exist, how they interact with your profile, and the design trade-offs.

## The problem

The skill compiler (explained in [How the Skill Compiler Works](explanation-skill-compiler.md)) generates SKILL.md files that let Claude Code call Kai's MCP tools via slash commands. But two gaps remained:

1. **No automatic profile injection.** Every new Claude Code session starts without knowing who you are or what your behavioral profile looks like. You had to manually run `/kai-profile` to bring context into the conversation.

2. **No observation collection from tool usage.** Kai's profile engine depends on observations, but there was no automatic way to detect behavioral patterns from your tool usage within Claude Code sessions.

Hooks solve problem 1 (SessionStart injects profile context). Workflow commands solve a related problem: they personalize command content based on your profile at install time, so each command adapts to your behavioral traits.

## Hook architecture

Kai generates three hooks during `kai skills install`:

### SessionStart hook (`kai-session-start.cjs`)

Runs once when Claude Code starts a new session. Reads your profile database (`~/.kai/kai.db`) and prints a one-line summary:

```
Kai profile active (A). Top traits: early_riser=0.85, tinkerer=0.72, detail_oriented=0.68
```

This appears as a system message in the Claude Code context, giving the AI agent awareness of your behavioral profile without you doing anything.

The hook also creates a session marker in the `autopilot_sessions` table, cleans up stale orphan sessions (>1 hour old), and generates behavior-adaptive nudges based on your top traits. Nudges are short guidance messages like "User prefers direct execution; skip explanations unless blocked." that help the AI adapt its behavior to your preferences.

The hook checks the minimum required schema version before executing. If the database doesn't exist or is on an old schema, it gracefully degrades to basic profile read or silently exits — no error output to avoid disrupting session startup.

### PostToolUse hook (`kai-auto-observe.cjs`)

Runs after every tool call that matches the allowlisted tool set (Bash, Read, Edit, Write, MultiEdit, Grep, Glob, WebSearch, WebFetch, TodoRead, TodoWrite). Captures each use as a `tool_usage` observation with the tool name, session ID, and input keys (not values — privacy protection).

This is how Kai learns that you "use Edit a lot" or "prefer Read over Bash for file inspection." Over time, these observations feed into trait derivation via five autopilot-specific rules — strengthening traits like `autonomy` (Bash usage), `detail_oriented` (Edit usage), or `exploratory` (search tools).

The hook uses a tool category allowlist defined in `constants.ts` — only behaviorally meaningful tools are captured, and only input keys (not values) are recorded for privacy. Schema version gates prevent the hook from executing on un-migrated databases. The 10-second timeout ensures the hook never blocks tool execution.

### Stop hook (`kai-stop.cjs`)

Runs when a Claude Code session ends. Closes the session marker, counts observations from the session using the `session_id` FK, runs trait derivation via `deriveFromRulesCore`, and updates session stats.

Derivation is the key action: it matches all accumulated observations against the 25 derivation rules, persists resulting traits, and records how many traits were derived. This means your profile evolves automatically between sessions without you needing to run `kai profile derive` manually.

The hook also prunes observations older than 30 days to prevent unbounded database growth. If the derive module is not available (e.g., Kai was uninstalled), the hook marks the session as `skipped` rather than failing.

The 30-second timeout gives derivation enough time to complete for sessions with many observations.

### Hook registration

Hooks are registered in `~/.claude/settings.json` (not `~/.claude.json` — these are different files with different schemas). The install command merges hook configurations into the existing settings without overwriting other hooks you may have configured:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "bun \"/path/to/kai-session-start.cjs\"" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Read|Edit|Write|MultiEdit|Grep|Glob|WebSearch|WebFetch|TodoRead|TodoWrite",
        "hooks": [{ "type": "command", "command": "bun \"/path/to/kai-auto-observe.cjs\"", "timeout": 10 }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "bun \"/path/to/kai-stop.cjs\"", "timeout": 30 }]
      }
    ]
  }
}
```

The `isKaiHook()` function detects existing Kai hooks by matching the command string against `kai-session-start`, `kai-auto-observe`, or `kai-stop` identifiers. This lets `kai skills install` update Kai's own hooks without touching hooks from other tools.

## Workflow commands

Workflow commands are slash commands (`/kai`, `/kai-profile`, etc.) generated at install time from `WorkflowDefinition` schemas in `src/cli/skills/workflows/definitions.ts`.

### Command generation pipeline

```
WorkflowDefinition schemas (definitions.ts)
  │
  ▼
CommandGenerator — reads profile, filters conditions by trait thresholds
  │
  ▼
Markdown command files — one per workflow, written to ~/.claude/commands/kai/
```

Each `WorkflowDefinition` specifies:
- **name** — the slash command name (e.g., `kai-profile`)
- **description** — what the command does
- **tools** — which MCP tools to call and with what parameters
- **profileConditions** — conditional content included only if a trait exceeds a threshold
- **emptyProfileFallback** — content shown when no profile exists

### Profile-aware trait baking

This is where personalization happens. When you run `kai skills install`, the `CommandGenerator` reads your current profile and compares each `profileCondition.threshold` against your actual trait values. Conditions that meet the threshold are "baked" into the generated command file as static markdown sections.

For example, if your `early_riser` trait is 0.85 (above the 0.7 threshold), the `/kai` command file includes:

```markdown
## Peak Focus Time
Based on your early_riser trait, your peak focus window is typically 6-10 AM.
Schedule deep work accordingly.
```

If your trait is 0.3 (below threshold), that section is omitted entirely. The command file is static markdown — it cannot execute runtime conditionals, so all personalization must happen at generation time.

**PII safety.** Only 14 behavioral dimension names and their numeric values are baked into command files. Identity fields (name, role, location) are explicitly excluded. The `PII_WHITELIST` in `src/cli/skills/commands/profile-aware.ts` controls which dimensions are safe to embed:

```
early_riser, tinkerer, consistent_user, detail_oriented, scope_appetite,
risk_tolerance, planning_style, schedule_rhythm, preferred_output_shape,
disliked_behavior, comm_style, domain_context, task_completion_rate, autonomy
```

These are behavioral tendencies, not personal data. A command file never contains your name, email, or identifying information.

### Intent-based triggers

Six domains (profile, observe, idea, work, prompt, telemetry) overlap between the skill compiler's domain-based SKILL.md files and the workflow command definitions. Without disambiguation, Claude Code might not know which to trigger.

The solution: overlapping domains use **intent-based triggers** instead of slash-command triggers. The skill compiler's `generateSkillMarkdown()` in `templates.ts` replaces the raw command list with a natural-language intent description:

| Domain | Trigger |
|--------|---------|
| profile | "questions about behavioral profile, trait values, profile summary, trait explanations" |
| observe | "submitting observations, recording behavioral data, logging preferences or patterns" |
| idea | "managing ideas, creating plans, approving tasks, executing work, orchestrating projects" |
| work | "getting work recommendations, checking task status, finding what to work on next" |
| prompt | "compiling prompts, evolving prompts, inspecting prompt variants, champion prompts" |
| telemetry | "querying telemetry, tracing requests, explaining system behavior, performance data" |

This way, the SKILL.md files activate on natural-language intent (e.g., "what's my profile?" triggers the profile skill), while the workflow commands activate on explicit slash commands (e.g., `/kai-profile` triggers the workflow command). No collision.

## The full lifecycle

```
Install (kai skills install):
  1. Generate SKILL.md files → ~/.claude/skills/kai/
  2. Read profile → bake traits into workflow commands
  3. Generate command files → ~/.claude/commands/kai/
  4. Generate hook scripts → ~/.claude/hooks/kai/
  5. Register hooks in ~/.claude/settings.json
  6. Register MCP server in ~/.claude.json

Each session:
  SessionStart hook → inject profile summary + nudges into context, create session marker, clean orphans
  User types /kai-* → workflow command executes with baked personalization
  PostToolUse hook → capture tool_usage observations for allowlisted tools
  Stop hook → close session, run derivation, update session stats, prune old observations
  Profile evolves automatically → reinstall to refresh baked traits
```

## Trade-offs

**Static vs. dynamic personalization.** Command files are static markdown generated at install time. If your profile changes, you must reinstall to refresh the baked traits. The alternative (dynamic lookups on every command invocation) would require runtime code execution, which Claude Code slash commands don't support. The SessionStart hook provides a lightweight dynamic complement — it injects live trait values at session start.

**Hook timeout constraint.** PostToolUse hooks run synchronously and must complete within their timeout (10 seconds). Auto-observe writes directly to the database on each invocation rather than batching, which is fast enough for the allowlisted tool set. The Stop hook has a longer timeout (30 seconds) to accommodate derivation processing on sessions with many observations.

**Observation quality vs. quantity.** The auto-observe hook captures tool names and input keys (not values) for allowlisted tools. This means "user reads many files" is observable, but "user reads files about authentication specifically" is not. This is a deliberate privacy trade-off: tool content could contain sensitive data, so only the tool name and input key names are recorded.

**Settings.json coexistence.** Kai hooks share `~/.claude/settings.json` with other tools. The `isKaiHook()` detection function ensures Kai only modifies its own hook entries. However, if you manually edit the settings file and change a Kai hook's command string, the next install will treat it as a non-Kai hook and add a duplicate. Fix: `kai skills uninstall` followed by `kai skills install`.

## Related

- [How to Use Workflow Slash Commands](howto-workflow-commands.md) — task-oriented guide for each command
- [How to Install and Manage Kai Skills](howto-skills.md) — install, doctor, uninstall lifecycle
- [How the Skill Compiler Works](explanation-skill-compiler.md) — the underlying compiler that generates SKILL.md files
