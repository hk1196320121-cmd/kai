# Changelog

## [0.1.0.0] - 2026-05-18

### Added
- Profile Engine with identity, observations, traits, and preferences CRUD
- SQLite database client with WAL mode, CHECK constraints, and schema migrations
- Rule-based trait derivation engine (early_riser, tinkerer, consistent_user)
- LLM-based trait derivation with OpenAI-compatible API and output validation
- Confidence decay engine with declared-trait immunity and daily-apply guard
- Trust model with provenance chain: `why` explains trait origin, `correct` removes incorrect traits
- Observation collector with SHA-256 dedup and cron schedule parsing
- Hermes bridge for reading cron outputs, skills, and job configs from file system
- CLI with `profile` (bootstrap, read, update, derive, why, correct, decay) and `observe` (from-cron, daily) subcommands
- 88 tests across 13 files covering core modules, bridge, collector, and E2E flows

### Fixed
- Profile read shows partial data (traits/observations) even without identity
- Timestamp format normalization for same-day observation queries
- `--field` flag guard against null identity in partial profile state
- Derivation rules aligned with actual collected cron data (schedule/hour extraction)
- Decay engine prevents double-apply on same day
- LLM provider only retries on transient errors (429, 5xx), not client errors

### Security
- LLM output dimension validation via allowlist (VALID_LLM_DIMENSIONS)
- Error messages sanitized to prevent response body leakage
- Bootstrap duplicate guard prevents multiple identity insertion
