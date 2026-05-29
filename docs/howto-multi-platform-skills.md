# How to Install Kai Skills on Multiple Platforms

Install Kai's skill files into Gemini CLI or Hermes so you can invoke Kai tools as slash commands from any supported AI coding tool.

## Prerequisites

- Kai installed (`bun add -g kai-profile` or cloned from source)
- At least one supported AI tool installed on your machine:

| Platform | Install detect | Config file | Config format |
|----------|---------------|-------------|---------------|
| Claude Code | `~/.claude/settings.json` exists | `~/.claude.json` | JSON |
| Gemini CLI | `~/.gemini/settings.json` exists | `~/.gemini/settings.json` | JSON |
| Hermes | `~/.hermes/config.yaml` exists | `~/.hermes/config.yaml` | YAML |

## Auto-detect and install for all platforms

If you have multiple AI tools installed, Kai detects them automatically:

```bash
kai skills install --configure-mcp
```

This scans for platform home directories and marker files. Each detected platform gets skill files in its own directory and an MCP server entry in its own config file. Output shows which platforms were detected and configured.

## Install for a specific platform

When you have multiple platforms but only want to install for one:

```bash
# Install for Gemini CLI only
kai skills install --configure-mcp --target gemini-cli

# Install for Hermes only
kai skills install --configure-mcp --target hermes

# Install for Claude Code only (even if others are detected)
kai skills install --configure-mcp --target claude-code
```

Valid target names: `claude-code`, `gemini-cli`, `hermes`.

## Verify the installation

Check all detected platforms at once:

```bash
kai skills doctor
```

Check a specific platform:

```bash
kai skills doctor --target gemini-cli
```

Doctor checks:
- `manifest.json` exists and is valid JSON
- Kai version in the manifest matches your current installation
- MCP server entry is present in the platform's config file
- Skill files are present in the install directory

If something is wrong, fix with:

```bash
kai skills doctor --fix --target gemini-cli
```

## List installed skills

```bash
# All platforms (auto-detect)
kai skills list

# Specific platform
kai skills list --target hermes
```

## Remove skills from a platform

```bash
# Remove from one platform
kai skills uninstall --target gemini-cli

# Remove from all platforms
kai skills uninstall
```

Removes the skill directory, MCP config entry, and (for Claude Code) workflow commands and hooks. Prompts for confirmation unless you pass `--force`.

## What gets installed where

Each platform has its own install path and config file:

### Gemini CLI

```
~/.gemini/skills/kai/        ← SKILL.md files + manifest.json
~/.gemini/settings.json      ← MCP server entry (JSON)
```

The MCP entry is added under the `mcpServers` key:

```json
{
  "mcpServers": {
    "kai": {
      "command": "bun",
      "args": ["run", "/path/to/kai/src/cli/index.ts", "mcp", "serve"]
    }
  }
}
```

### Hermes

```
~/.hermes/skills/kai/        ← SKILL.md files + manifest.json
~/.hermes/config.yaml        ← MCP server entry (YAML)
```

The MCP entry is added under the `mcp_servers` key:

```yaml
mcp_servers:
  kai:
    command: bun
    args:
      - run
      - /path/to/kai/src/cli/index.ts
      - mcp
      - serve
```

### Claude Code

```
~/.claude/skills/kai/        ← SKILL.md files + manifest.json
~/.claude/commands/kai/      ← Workflow slash commands (/kai, /kai-profile, etc.)
~/.claude/hooks/kai/         ← Hook scripts (SessionStart, PostToolUse)
~/.claude.json               ← MCP server entry (JSON)
~/.claude/settings.json      ← Hook registrations
```

Claude Code is the only platform that supports workflow commands and hooks. Gemini CLI and Hermes get skill files and MCP configuration only.

## How platform detection works

`detectPlatforms()` checks three things for each platform, in order:

1. **Kai manifest present** — if `~/.<platform>/skills/kai/manifest.json` exists, the platform counts as detected (you've installed Kai skills there before)
2. **Platform home + marker file** — if `~/.<platform>/` exists and contains its marker file (`settings.json` for Claude Code and Gemini CLI, `config.yaml` for Hermes), the platform itself is installed
3. **Neither found** — platform is skipped

You can override auto-detection with `--target` at any time.

## Troubleshooting

**"Target 'x' is not registered"** — you passed an invalid `--target` value. Valid targets: `claude-code`, `gemini-cli`, `hermes`, `all`.

**"No platforms detected"** — Kai can't find any AI tool home directories. Either install a supported tool or use `--target` to specify one explicitly.

**"Conflicting MCP entry"** — the platform's config file already has a `kai` entry with different settings. Use `--force` to overwrite:

```bash
kai skills install --configure-mcp --target gemini-cli --force
```

**"Cannot read settings.json"** — the file exists but contains invalid JSON. Fix the JSON manually, then retry.

**Skills installed but AI tool doesn't see them** — restart the AI tool. Most tools discover skills on launch, not mid-session.

## Related

- [How to Install and Manage Kai Skills](howto-skills.md) — Claude Code-specific install guide
- [CLI Reference](reference-cli.md) — full `kai skills` command reference with all flags
- [How the Skill Compiler Works](explanation-skill-compiler.md) — target adapter architecture and design trade-offs
