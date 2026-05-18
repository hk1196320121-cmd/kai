# Kai

Intelligent task orchestration and personal assistant system. Kai builds a deep understanding of who you are through behavioral observation, then uses that profile to personalize every interaction.

## What it does

Kai watches what you do (cron outputs, daily patterns, explicit preferences) and builds a living user profile: identity, behavioral traits, and preferences. Other AI tools can then ask Kai "who is this person?" and get a rich, evidence-based answer.

Core capabilities:
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

## Architecture

```
src/
  cli/            Commander.js CLI (profile, observe subcommands)
  core/profile/   Profile engine, derivator, decay, provenance, collector
  bridge/         Hermes bridge (file system reads for cron data)
  db/             SQLite client with WAL mode and schema migrations
  llm/            OpenAI-compatible LLM provider with transient-error retry
```

Data flows: **Hermes cron outputs** -> **Collector** (dedup) -> **Observations** (SQLite) -> **Derivator** (rules + LLM) -> **Traits** -> **Decay** (time-based confidence) -> **Provenance** (evidence chain).

Profile data is stored in `~/.kai/profile.db` (SQLite with WAL mode).

## Development

```bash
# Run tests
bun test

# Watch mode
bun test --watch

# Run CLI in dev mode
bun run dev profile bootstrap
```

## License

Private project.
