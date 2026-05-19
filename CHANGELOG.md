# Changelog

## [0.2.0.0] - 2026-05-19

### Added
- **MCP Server** — full Model Context Protocol server with stdio transport. Start with `kai mcp serve`
- **5 MCP tools**: `profile.read` (identity/traits/summary/full scopes), `profile.why` (trait provenance), `observe.submit` (with rate limiting and dedup), `observe.batch` (bulk submit), `derive.trigger` (rules/llm/both methods)
- **6 MCP resources**: `kai://profile/identity`, `kai://profile/traits`, `kai://profile/traits/{dimension}`, `kai://profile/observations/recent`, `kai://profile/summary`, `kai://system/health`
- **Persistent trait corrections** — corrected traits are now stored in a corrections table and survive re-derivation
- **SHA-256 dedup** — extracted to standalone module with context/tag-aware hashing
- **Confidence scale conversion** — transparent mapping between MCP (0-1) and internal (1-10) scales
- **MCP derivation rules** — new rules for `detail_oriented`, `scope_appetite`, `risk_tolerance` from MCP observations
- **Structured stderr logging** — JSON-line format for all MCP tool/resource operations
- **Biome linter + Knip dead code detection** — health stack tooling
- **152 tests** across 20 files (+64 new tests since v0.1.0)

### Changed
- `profile.why` now includes rule-matched observations alongside related observations
- Derivation rules skip corrected dimensions (no re-deriving traits you already corrected)
- `tinkerer` rule extended to accept `mcp:` observation keys
- Database schema versioned to v3 (corrections table) with transaction-safe v2 migration

### Fixed
- Trait corrections are now persistent — re-running derive no longer recreates corrected traits
- `profile.read` identity scope no longer leaks internal fields (id, timestamps)
- Database migration v2 now wraps DDL in a transaction for crash safety
- Removed unused `_SCHEMA_VERSION` constant
- Extracted shared `safeJsonParse` and `log` utilities (was duplicated in handlers)
- Removed redundant entries from `VALID_LLM_DIMENSIONS`

## [0.1.0.0] - 2026-05-18

### Added
- **Profile Engine** — build a user profile through identity, observations, traits, and preferences. Start with `kai profile bootstrap`
- **Local SQLite storage** with write-ahead logging and built-in data integrity checks
- **Trait derivation** — automatically discovers behavioral traits from observations. Rule-based (early_riser, tinkerer, consistent_user) and LLM-powered inference
- **Confidence decay** — traits weaken over time unless reinforced by new observations. Declared traits (set by you) stay permanent
- **Provenance chain** — every trait has evidence behind it. `kai profile why <trait>` shows the reasoning, `kai profile correct <trait>` removes wrong ones
- **Observation collection** — gather behavioral data from cron outputs with automatic deduplication. `kai observe daily` scans everything at once
- **Hermes bridge** — reads cron outputs, skill configs, and job data directly from the file system
- **Full CLI** — `profile` (bootstrap, read, update, derive, why, correct, decay) and `observe` (from-cron, daily) subcommands
- 88 tests across 13 files covering all core modules, bridge, collector, and end-to-end flows

### Fixed
- `profile read` now handles partial profiles gracefully (traits/observations visible even without identity)
- Same-day observation queries return consistent results across timezone boundaries
- `--field` flag no longer crashes when identity hasn't been set yet
- Trait derivation rules now match the actual format of collected cron data
- Confidence decay won't apply twice on the same day
- LLM provider stops retrying on client errors (400/401/403) — only retries on rate limits and server issues

### Security
- LLM output dimension validation via allowlist (VALID_LLM_DIMENSIONS)
- Error messages sanitized to prevent response body leakage
- Bootstrap duplicate guard prevents multiple identity insertion
