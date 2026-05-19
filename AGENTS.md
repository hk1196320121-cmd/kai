# Kai — AI Behavioral Profile Engine

MCP server that builds and serves a behavioral profile from observations. AI agents connect via Model Context Protocol (stdio) to read user profiles, submit observations, and derive behavioral traits.

## Quick Reference

```bash
# Start MCP server (stdio transport)
kai mcp serve

# Start with custom database path
kai mcp serve --db /path/to/profile.db
```

## MCP Tools (5)

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

## MCP Resources (6)

Resources are read-only profile access endpoints. All return `application/json`.

| URI | Description |
|-----|-------------|
| `kai://profile/identity` | User identity fields |
| `kai://profile/traits` | All behavioral traits with confidence scores |
| `kai://profile/traits/{dimension}` | Single trait by dimension name |
| `kai://profile/observations/recent` | 50 most recent observations |
| `kai://profile/summary` | Profile summary: identity + top 5 traits by confidence |
| `kai://system/health` | Database integrity check + observation/trait counts |

## CLI Commands

```bash
# Profile management
kai profile bootstrap              # Interactive first-time setup
kai profile read                   # View profile
kai profile read --json            # JSON output
kai profile read --field <name>    # Single identity field
kai profile update --field <name> --value <val>
kai profile derive                 # Derive traits from observations
kai profile why <dimension>        # Trait provenance
kai profile correct <dimension>    # Remove incorrect trait
kai profile decay                  # Apply confidence decay

# Observation collection
kai observe from-cron <file>       # Extract from cron output file
kai observe daily                  # Scan all Hermes cron outputs

# MCP server
kai mcp serve                      # Start MCP server (stdio)
kai mcp serve --db <path>          # Custom database path
```

## Architecture

```
src/
  cli/              Commander.js CLI (profile, observe, mcp subcommands)
  mcp/              MCP server — handlers, resources, schema, stdio transport
    server.ts       Server creation and startup
    handlers.ts     5 tool handlers with rate limiting and dedup
    resources.ts    6 resource endpoints
    schema.ts       Zod input validation schemas
    utils.ts        safeJsonParse, structured logging
  core/profile/     Profile engine core
    engine.ts       CRUD for identity, observations, traits, preferences
    derivator.ts    Rule-based + LLM trait derivation (6 rules)
    provenance.ts   Trait provenance chain and correction tracking
    dedup.ts        SHA-256 deduplication (content + tags + context)
    decay.ts        Time-based confidence decay (declared traits immune)
    mcp-scale.ts    MCP (0–1) ↔ internal (1–10) confidence conversion
    collector.ts    Hermes cron output parsing and batch collection
    types.ts        Core type definitions
  bridge/           Hermes bridge (file system reads for cron data)
  db/               SQLite client with WAL mode and schema migrations (v1–v3)
  llm/              OpenAI-compatible LLM provider with retry logic
```

Data flows:
- **CLI path**: Hermes cron → Collector (dedup) → Observations (SQLite) → Derivator (rules + LLM) → Traits → Decay → Provenance
- **MCP path**: AI agent → stdio → MCP handlers → ProfileEngine → SQLite
- Both paths share the same database (`~/.kai/profile.db`)

## Key Concepts

**Confidence scale**: MCP tools use 0–1 (continuous). Internal storage uses 1–10 (discrete). Conversion is automatic via `mcpToInternal()` / `internalToMcp()`.

**Deduplication**: Observations are hashed (SHA-256) using content + tags + context. Namespace format: `mcp:{tool}:{hash}`. Duplicate submissions return the existing observation.

**Trait derivation rules** (6 built-in):
- `early_riser`: Matches cron patterns indicating morning activity
- `tinkerer`: Matches experimentation/tool usage patterns (accepts `mcp:` keys)
- `consistent_user`: Matches regular daily usage patterns
- `detail_oriented`: Matches MCP observations showing thorough, detailed behavior
- `scope_appetite`: Matches observations indicating willingness to explore broadly
- `risk_tolerance`: Matches observations showing risk-taking or cautious behavior

**Corrections**: When a user corrects a trait via `profile.correct`, the correction is stored in a `corrections` table. Derivation skips corrected dimensions — the trait won't reappear after re-running `derive.trigger`.

**Decay**: Traits weaken over time unless reinforced by new observations. Declared traits (set directly by user) are immune to decay. Only available via CLI (`kai profile decay`), not MCP.

## Data Model

**Identity**: name, role, location, timezone, communication_style, interests (user-editable fields)

**Observation**: text, source (cron_output|session_log|user_stated|inferred|mcp), type (behavior|preference|feedback|context|signal), confidence (1–10), tags, context, timestamp

**Trait**: dimension, value (0–1), confidence (1–10), source (declared|observed|inferred|cross-model), timestamp

**Correction**: dimension, reason, timestamp — prevents re-derivation of corrected traits

## Database

SQLite with WAL mode. Default path: `~/.kai/profile.db`. Schema versioned (v1–v3). Migrations run automatically on startup with transaction-safe DDL.

## Development

```bash
bun install          # Install dependencies
bun test             # Run tests (152 across 20 files)
bun test --watch     # Watch mode
bun run typecheck    # Type-check with tsc --noEmit
bun run lint         # Lint with Biome
bun run dev <cmd>    # Run CLI in dev mode
```

Health stack: `bun run typecheck`, `bun run lint`, `bun test`, `npx knip` (dead code). CI (GitHub Actions) runs all three checks on every push and PR.
