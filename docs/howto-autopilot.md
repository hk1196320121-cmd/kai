# How to Set Up and Use Autopilot

Install Kai's autopilot hooks so your profile evolves automatically as you work. No manual `kai profile derive` needed.

## Prerequisites

- [Bun](https://bun.sh) 1.3.13+ installed
- Kai installed globally (`bun add -g kai-profile`) or cloned for development
- Claude Code CLI (autopilot hooks only work with Claude Code)
- A Kai profile (run `kai work start` first if you don't have one)

## Install the hooks

Autopilot installs three hooks into Claude Code: SessionStart, PostToolUse, and Stop. Together they track your tool usage and derive traits at session end.

```bash
kai hooks install
```

Output:

```
Kai autopilot hooks installed.
  Scripts: ~/.claude/hooks/kai
  Settings: ~/.claude/settings.json
```

This writes three hook scripts to `~/.claude/hooks/kai/` and registers them in `~/.claude/settings.json`. The hooks run automatically when you use Claude Code.

## Verify the installation

Check that all three hooks are present and registered:

```bash
kai hooks status
```

Output:

```
Kai Autopilot Hooks Status
---
Scripts:
  ✓ kai-session-start.cjs
  ✓ kai-auto-observe.cjs
  ✓ kai-stop.cjs
Settings hooks: 3 registered
  → bun "/path/to/kai-session-start.cjs"
  → bun "/path/to/kai-auto-observe.cjs"
  → bun "/path/to/kai-stop.cjs"
```

All three scripts must show ✓. If any show ✗, run `kai hooks install` again.

## What happens in each session

Once hooks are installed, the autopilot cycle runs without any action from you:

1. **Session starts** — SessionStart hook injects your profile summary and nudges into Claude Code's context. A session marker is created in the database.

2. **You work** — PostToolUse hook records tool usage observations for allowlisted tools (Bash, Edit, Read, Write, Grep, Glob, WebSearch, WebFetch, TodoRead, TodoWrite, MultiEdit). Only tool names and input keys are recorded, never values.

3. **Session ends** — Stop hook closes the session, runs trait derivation against all 25 rules, and prunes observations older than 30 days.

## Check session history

See recent sessions and their derivation results:

```bash
kai autopilot status
```

Output:

```
Kai Autopilot Sessions
---
Active: abc123 (started 2026-05-30T10:00:00Z)

Recent sessions:
  ✓ def456 — 47 obs, 5 traits (32min)
  ✓ ghi789 — 23 obs, 3 traits (15min)
  — jkl012 — 12 obs, 0 traits (skipped)
```

Status symbols:
- ✓ — derivation completed, traits updated
- ✗ — derivation failed (check database health)
- — — derivation skipped (derive module not found)
- … — session still active

## Nudge system

The SessionStart hook generates nudges based on your top traits. You'll see them as system messages when a session starts, like:

```
Kai profile active (A). Top traits: early_riser=0.85, autonomy=0.90, detail_oriented=0.65
[kai] User prefers direct execution; skip explanations unless blocked. (autonomy=0.90)
```

Nudges adapt to your profile automatically. If your traits change, nudges change on the next session. No configuration needed.

## Five autopilot derivation rules

The PostToolUse observations feed into five derivation rules that run at session end:

| Rule | Tool pattern | What it measures |
|------|-------------|------------------|
| `autonomy` | Bash | Hands-on execution preference |
| `detail_oriented` | Edit | Careful, surgical modification style |
| `exploratory` | Grep, Glob, WebSearch | Search and exploration breadth |
| `code_focus` | Edit, Write, Read | Code editing intensity |
| `planning_style` | TodoRead, TodoWrite | Structured task management |

These rules add to the existing 20 derivation rules (from MCP, cron, coldstart signals, and git patterns), bringing the total to 25.

## Uninstall

Remove all Kai hooks from Claude Code:

```bash
kai hooks uninstall
```

This removes hook registrations from `~/.claude/settings.json`. Hook scripts remain on disk at `~/.claude/hooks/kai/` — delete them manually if you want a clean removal.

## Troubleshooting

### "No autopilot sessions recorded yet"

Hooks are not installed, or Claude Code hasn't started a session since installation. Fix:

```bash
kai hooks install
kai hooks status    # Verify all three scripts show ✓
```

Then start a new Claude Code session and end it. Run `kai autopilot status` to confirm.

### Hooks show ✗ but install succeeded

The scripts directory might be wrong. Check with `--hooks-dir`:

```bash
kai hooks status --hooks-dir ~/.claude/hooks/kai
```

If scripts are elsewhere, reinstall with the correct directory:

```bash
kai hooks install --hooks-dir ~/.claude/hooks/kai
```

### Derivation status shows "skipped"

The Stop hook could not find the `derive-shared` module. This happens when Kai was uninstalled or the module path changed. Fix:

```bash
kai hooks install    # Reinstalls with updated paths
```

### Derivation status shows "failed"

Database corruption or migration issue. Check database health:

```bash
kai profile read    # If this fails, the database needs attention
```

If the database schema is pre-v9, the hooks will gracefully degrade (no session tracking, no tool_usage observations). Run `kai mcp serve` once to trigger the v9 migration, then restart Claude Code.

### Hooks not firing after a Kai update

Kai updates don't automatically reinstall hooks. After updating Kai:

```bash
kai hooks install    # Reinstalls scripts with updated code
```

### Conflicts with other hooks in settings.json

Kai hooks use `isKaiHook()` detection to avoid touching hooks from other tools. If you manually edited a Kai hook's command string in `settings.json`, Kai treats it as a non-Kai hook and may add a duplicate on next install. Fix:

```bash
kai hooks uninstall
kai hooks install
```

## Related

- [How Hooks and Workflow Commands Work](explanation-hooks-and-commands.md) — architecture, design trade-offs, and the three-hook lifecycle
- [CLI Reference](reference-cli.md) — full `kai hooks` and `kai autopilot` command reference with all flags
- [Database Schema Reference](reference-database.md) — `autopilot_sessions` table, observations columns, migration history
- [How to Configure Kai](howto-configure.md) — environment variables, database path overrides
