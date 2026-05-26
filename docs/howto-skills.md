# How to Install and Manage Kai Skills

Generate SKILL.md files from Kai's MCP tool schemas so you can invoke any Kai tool from Claude Code via slash commands like `/kai-profile`, `/kai-work`, `/kai-idea`.

## Prerequisites

- Kai installed (`bun add -g kai-profile` or cloned from source)
- Claude Code CLI configured

## Install skills

```bash
kai skills install --configure-mcp
```

This does two things:

1. **Generates skill files** in `~/.claude/skills/kai/`. One master `SKILL.md` plus 7 domain-specific files (profile, observe, derive, work, idea, prompt, telemetry). Each file contains the slash commands, tool descriptions, and parameter schemas for that domain.

2. **Configures MCP** in `~/.claude.json` by adding the `kai` MCP server entry pointing to `kai mcp serve`. This is what makes the tools actually callable.

If you see "Conflicting MCP entry", your `~/.claude.json` already has a `kai` entry with different settings. Either edit it manually or run:

```bash
kai skills install --configure-mcp --force
```

To regenerate skill files without touching MCP config, omit `--configure-mcp`:

```bash
kai skills install
```

## Verify the installation

```bash
kai skills doctor
```

This checks:

- `manifest.json` exists and is valid JSON
- The Kai version in the manifest matches your current installation
- No new tools have been added since the last install
- No tools have been removed

Output looks like:

```
✓ Installation valid.
ℹ Version: v0.10.0.1
```

If something is wrong, fix it with:

```bash
kai skills doctor --fix
```

This reinstalls all skill files from scratch.

## List installed skills

```bash
kai skills list
```

Shows each domain and its associated tools:

```
Kai Skills
Version: 0.10.0.1
Generated: 2026-05-27T01:30:00.000Z

  ✓ derive — derive.trigger
  ✓ idea — kai_idea_submit, kai_idea_plan, kai_plan_approve, kai_task_execute, kai_idea_pause, kai_replan
  ✓ observe — observe.submit, observe.batch
  ✓ profile — profile.read, profile.why
  ✓ prompt — prompt.compile, prompt.champion, prompt.evolve
  ✓ telemetry — telemetry.query, telemetry.trace, telemetry.explain
  ✓ work — kai_work_recommend, kai_execution_status
```

## Uninstall

```bash
kai skills uninstall
```

Removes `~/.claude/skills/kai/` (all generated files) and the `kai` MCP entry from `~/.claude.json`. Prompts for confirmation unless you pass `--force`.

## When to reinstall

Reinstall after upgrading Kai. New versions may add or remove MCP tools, and the generated skill files need to reflect the current tool surface.

```bash
kai skills install --configure-mcp --force
```

## Troubleshooting

**"No manifest.json found"** — skills were never installed or the install directory was corrupted. Run `kai skills install`.

**"Skills generated with Kai vX. Current: vY"** — your skill files are from an older Kai version. Run `kai skills install` to regenerate.

**"N new tool(s) available"** — Kai added tools since your last install. Run `kai skills install` to pick them up.

**"Cannot read ~/.claude.json"** — the file exists but contains invalid JSON. Fix the JSON manually, then retry.

**"Conflicting MCP entry for 'kai'"** — `~/.claude.json` has a `kai` MCP server with different command/args than what `kai skills install` would set. Use `--force` to overwrite, or edit `~/.claude.json` by hand.
