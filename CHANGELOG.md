# Changelog

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
