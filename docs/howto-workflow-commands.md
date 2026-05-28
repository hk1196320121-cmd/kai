# How to Use Workflow Slash Commands

Use Kai's 8 workflow slash commands to interact with your behavioral profile, submit observations, plan ideas, and evolve prompts — all from within Claude Code.

## Prerequisites

- Kai installed (`bun add -g kai-profile` or cloned from source)
- Claude Code CLI configured
- Skills installed: `kai skills install --configure-mcp`

If you see "No profile yet" when running commands, bootstrap your profile first:

```bash
kai work start
```

## The 8 commands

| Command | What it does |
|---------|-------------|
| `/kai` | Behavioral dashboard: profile summary + task recommendations |
| `/kai-profile` | Full profile view with trait evolution and personalized insights |
| `/kai-observe` | Submit observations about your behavior or preferences |
| `/kai-why` | Explain why a trait has its current value (provenance chain) |
| `/kai-plan` | Submit an idea and generate an execution plan |
| `/kai-status` | Check execution status of your ideas and tasks |
| `/kai-reflect` | Reflect on your current session and batch-submit observations |
| `/kai-evolve` | Run prompt evolution to improve Kai's internal prompts |

## `/kai` — Behavioral dashboard

Type `/kai` in Claude Code to see your profile summary and personalized recommendations.

```bash
# In Claude Code:
/kai
```

Output includes:
- Profile summary (identity, top traits)
- Up to 3 task recommendations matched to your traits
- Personalized insights (e.g., "Peak Focus Time" if you're an early riser)

If your profile is empty, you'll see a prompt to run `kai work start`.

## `/kai-profile` — Full profile view

Type `/kai-profile` to see your complete behavioral profile with all trait details.

```bash
/kai-profile
```

This calls `profile.read` with `scope: "full"`, showing all traits with values, confidence scores, and provenance. If you have a `detail_oriented` trait above 0.7, the output includes full trait breakdowns.

## `/kai-observe` — Submit observations

Type `/kai-observe` to submit one or more observations about your behavior.

```bash
/kai-observe
```

Then describe what you want to observe. The command uses both `observe.submit` and `observe.batch` to record your input as profile data.

## `/kai-why` — Explain a trait

Type `/kai-why` followed by a dimension name (or just describe what you want explained).

```bash
/kai-why early_riser
```

This calls `profile.why` with the dimension you specify. Returns the provenance chain: which observations contributed, which rules fired, and the reasoning. If the dimension doesn't exist, the command asks you to pick one.

## `/kai-plan` — Plan an idea

Type `/kai-plan` and describe what you want to accomplish.

```bash
/kai-plan Refactor the auth module to use JWT tokens
```

This submits the idea via `kai_idea_submit` and generates a plan via `kai_idea_plan`. If your `planning_style` trait is high, the plan breaks into granular tasks with dependencies.

## `/kai-status` — Check execution status

Type `/kai-status` to see how your ideas and tasks are progressing.

```bash
/kai-status
```

Calls `kai_execution_status` to show task states, exit codes, and timestamps. With a high `detail_oriented` trait, includes full execution traces.

## `/kai-reflect` — Session reflection

Type `/kai-reflect` at the end of a session to summarize what happened and submit observations.

```bash
/kai-reflect
```

Queries recent tool usage from telemetry (last hour) and offers to batch-submit observations about your session patterns.

## `/kai-evolve` — Evolve prompts

Type `/kai-evolve` to run prompt evolution on Kai's internal prompts.

```bash
/kai-evolve
```

Compiles the current prompt, then runs evolution with tournament-based A/B testing. If your `risk_tolerance` trait is high, runs wider exploration with more mutation rounds.

## Profile-aware content

Commands include personalized content based on your behavioral traits. This happens at install time — when you run `kai skills install`, Kai reads your profile and "bakes" relevant traits into each command file. If your profile changes, reinstall to refresh:

```bash
kai skills install --force
```

The SessionStart hook also injects a live profile summary at the start of each Claude Code session.

## Verification

After installing skills, verify the commands exist:

```bash
ls ~/.claude/commands/kai/
```

You should see 8 `.md` files. If any are missing:

```bash
kai skills doctor
```

## Troubleshooting

**"No profile yet"** — the commands work but show generic content instead of personalized insights. Run `kai work start` to build your profile, then `kai skills install --force` to regenerate commands with your traits.

**Commands not appearing** — Claude Code needs to discover the command files. Restart Claude Code or check that `~/.claude/commands/kai/` contains the `.md` files.

**"Profile is empty" warning during install** — Kai couldn't read your profile database. The commands will use defaults. Build a profile with `kai work start` and reinstall.

## Related

- [How to Install and Manage Kai Skills](howto-skills.md) — install, doctor, uninstall lifecycle
- [How the Hooks and Workflow Commands Work](explanation-hooks-and-commands.md) — design rationale and architecture
- [How the Skill Compiler Works](explanation-skill-compiler.md) — the underlying compiler pipeline
