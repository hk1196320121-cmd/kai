# MCP Server Reference

Complete API reference for Kai's Model Context Protocol server. Covers all tools, resources, schemas, error handling, and behavior.

## Starting the Server

```bash
kai mcp serve                  # Default database: ~/.kai/profile.db
kai mcp serve --db /path/db    # Custom database path
```

The server uses stdio transport. It reads JSON-RPC from stdin and writes to stdout. Structured logs go to stderr in JSON-line format.

## Tools

### profile.read

Reads user profile data. Returns different shapes depending on scope.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| scope | `"identity"` \| `"traits"` \| `"summary"` \| `"full"` | Yes | Which data to return |
| dimensions | `string[]` | No | Filter traits to these dimensions (only with `scope: "traits"`) |

**Scopes:**

| Scope | Returns |
|-------|---------|
| `identity` | `{ name, role, location, timezone, communication_style, interests }`. Omits internal fields (id, timestamps). |
| `traits` | Array of `{ dimension, value, confidence, source, timestamp }`. Optional `dimensions` filter. |
| `summary` | `{ identity, topTraits: Trait[] }`. Top 5 traits sorted by confidence. |
| `full` | `{ identity, traits, observations, preferences }`. Complete profile snapshot. |

**Error responses:** Returns `{ error: string }` for database failures. Returns empty arrays/objects for profiles with no data — never throws.

### profile.why

Explains why a trait has its current value. Shows the provenance chain: contributing observations, matched rules, and derived reasoning.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| dimension | `string` | Yes | Trait dimension to explain (e.g., `"early_riser"`) |

**Returns:**

```json
{
  "dimension": "early_riser",
  "value": 0.8,
  "confidence": 7,
  "source": "observed",
  "relatedObservations": [
    { "id": 42, "text": "...", "confidence": 8, "timestamp": "..." }
  ],
  "ruleMatchedObservations": [
    { "id": 15, "text": "...", "rule": "early_riser" }
  ]
}
```

Returns `null` if dimension doesn't exist or has no trait.

### observe.submit

Submits a single observation. Deduplicated by SHA-256 hash of `text + tags + context`.

**Input schema:**

| Parameter | Type | Required | Constraints | Description |
|-----------|------|----------|-------------|-------------|
| text | `string` | Yes | 1–10240 chars | Observation content |
| sourceTool | `string` | Yes | 1–64 chars | Name of the submitting tool. Colons (`:`) replaced with `_`. |
| confidence | `number` | No | 0–1 (MCP scale) | Automatically converted to internal 1–10 scale |
| tags | `string[]` | No | — | Category labels for filtering |
| context | `string` | No | — | Extra context included in dedup hash |

**Rate limit:** 60 requests per 60-second window. Returns error on exceed.

**Dedup:** Hash namespace: `mcp:{sourceTool}:{sha256(text+tags+context)}`. If a duplicate exists, returns the existing observation with `duplicate: true`.

**Returns:** Stored observation with `id`, `key`, `timestamp`.

### observe.batch

Submits up to 50 observations in one call. Same schema and dedup as `observe.submit`.

**Input schema:**

| Parameter | Type | Required | Constraints | Description |
|-----------|------|----------|-------------|-------------|
| sourceTool | `string` | Yes | 1–64 chars | Tool name for all observations |
| observations | `Array<{ text, confidence?, tags?, context? }>` | Yes | 1–50 items | Observation batch |

**Returns:** Array of stored observations or duplicate notices.

### derive.trigger

Triggers trait derivation from collected observations.

**Input schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| method | `"rules"` \| `"llm"` \| `"both"` | Yes | Derivation method |

**Methods:**

| Method | Behavior |
|--------|----------|
| `rules` | Applies 6 built-in pattern rules. Fast, deterministic. |
| `llm` | Uses LLM to infer traits. Requires `OPENAI_API_KEY` or compatible endpoint configured. Falls back gracefully on failure. |
| `both` | Runs rules first, then LLM. Merges results. |

**Derivation rules:**

| Rule | Dimension | Matches | Derives |
|------|-----------|---------|---------|
| Early riser | `early_riser` | Cron patterns showing morning (5–9 AM) activity | value 0–1, confidence based on match count |
| Tinkerer | `tinkerer` | Experimentation/tool usage (accepts `mcp:` keys) | value 0–1, confidence based on diversity |
| Consistent user | `consistent_user` | Regular daily usage patterns | value 0–1, confidence based on streak |
| Detail oriented | `detail_oriented` | MCP observations showing thorough behavior | value 0–1, confidence based on text length |
| Scope appetite | `scope_appetite` | Observations showing broad exploration | value 0–1, confidence based on topic diversity |
| Risk tolerance | `risk_tolerance` | Observations showing risk-taking behavior | value 0–1, confidence based on risk indicators |

**Skips:** Dimensions with active corrections are never re-derived.

**Returns:** Array of `{ dimension, value, confidence, source }` for newly derived traits.

## Resources

Read-only profile access. All return `application/json`.

### kai://profile/identity

User identity fields (name, role, location, timezone, communication_style, interests).

### kai://profile/traits

All traits with dimension, value (0–1 MCP scale), confidence (1–10), source, and timestamp.

### kai://profile/traits/{dimension}

Template resource. Replace `{dimension}` with a trait name (e.g., `kai://profile/traits/early_riser`). Returns single trait or 404.

### kai://profile/observations/recent

50 most recent observations, newest first. Includes text, source, type, confidence, tags.

### kai://profile/summary

Profile summary: identity fields + top 5 traits sorted by confidence.

### kai://system/health

System health check. Returns:

```json
{
  "status": "ok",
  "database": {
    "path": "~/.kai/profile.db",
    "sizeBytes": 45056,
    "integrity": "ok",
    "observationCount": 234,
    "traitCount": 8
  }
}
```

## Confidence Scale Conversion

| MCP (0–1) | Internal (1–10) | Meaning |
|-----------|-----------------|---------|
| 0.0 | 1 | Very low |
| 0.22 | 3 | Low |
| 0.44 | 5 | Moderate |
| 0.67 | 7 | High |
| 0.89 | 9 | Very high |
| 1.0 | 10 | Certain |

Formula: `internal = round(mcp * 9) + 1`. Reverse: `mcp = (internal - 1) / 9`.

## Error Handling

All tools return `{ error: string }` on failure. Common errors:

| Error | Cause |
|-------|-------|
| Rate limit exceeded | More than 60 `observe.submit` calls per minute |
| LLM not configured | `derive.trigger` with `llm` or `both` but no API key |
| Dimension not found | `profile.why` with unknown dimension |
| Database error | SQLite issues (locked, corrupt, disk full) |

Logs go to stderr in JSON-line format: `{ ts, msg, data }`.
