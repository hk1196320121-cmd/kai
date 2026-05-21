# Changelog

## [0.6.0.0] - 2026-05-22

### Added
- **Flight Recorder telemetry system** — full causal chain tracing from MCP request through derivation, orchestration, and prompt genome operations. Every tool call gets a trace, spans, events, state changes, and error records
- **TelemetryStore** — SQLite CRUD for 5 telemetry tables with SQL injection protection (table allowlist, semicolon rejection, comma-join blocking, UNION blocking, row limit cap)
- **TelemetryRecorder** — deferred transaction writes with in-memory pending spans, fire-and-forget error handling, and bounded memory via MAX_PENDING_SPANS cap
- **Recursive attribute sanitizer** — automatic redaction of API keys, tokens, secrets, passwords, and credentials in telemetry payloads
- **Statistics layer** — error rate, P95 latency, top operations, and state drift detection over configurable time windows
- **LLM-powered explain** — natural language telemetry analysis with rate limiting (10 calls/hour), result caching, and stats-only fallback when no API key is available
- **3 MCP telemetry tools** — `telemetry.query` (SQL against telemetry views), `telemetry.trace` (full causal chain with suggested actions), `telemetry.explain` (LLM analysis)
- **3 MCP telemetry resources** — `kai://telemetry/trace/{traceId}`, `kai://telemetry/recent-errors`, `kai://telemetry/health`
- **5 CLI telemetry commands** — `kai telemetry health`, `kai telemetry query`, `kai telemetry trace`, `kai telemetry errors`, `kai telemetry explain`
- **V7 database migration** — 5 telemetry tables, 10+ indices, 5 views. Upgrades from v6 automatically
- **Orchestrator instrumentation** — Planner, Dispatcher, Observer, and Derivator all emit traces and spans with status and error tracking
- **Prompt genome instrumentation** — TournamentRunner and JudgeEngine emit traces; JudgeEngine uses telemetry for scoring
- **withTrace MCP handler wrapper** — generic instrumentation wrapper for all MCP tool handlers with automatic span/trace lifecycle management
- **Telemetry-driven judge scoring** — JudgeEngine.telemetryScore() uses recent trace data to inform tournament battles
- **30-day retention pruning** — automatic telemetry cleanup on 24-hour interval with configurable KAI_TELEMETRY_RETENTION_DAYS env var

### Changed
- `queryTelemetry` uses table allowlist instead of keyword denylist for stronger SQL injection protection
- `flushBatch` scopes FK toggle tightly around the transaction to minimize the race window
- `explainTelemetry` no longer caches LLM failure responses, allowing retry after transient errors
- `getTelemetryStats` validates `lastHours` parameter (falls back to 24 for NaN/negative/non-finite)

### Fixed
- Comma-join SQL injection bypass in telemetry query allowlist (reported by Codex adversarial review)
- Unbounded memory growth in TelemetryRecorder.pendingSpans via MAX_PENDING_SPANS eviction cap
- LLM failure responses cached with 5-minute TTL, blocking retries after recovery
- BEGIN/ROLLBACK overhead on read-only telemetry queries removed

## [0.5.0.0] - 2026-05-21

### Added
- **Prompt Genome system** — evolutionary prompt optimization with 5 gene types (intent, contract, adapter, example, tone), profile-aware segments, and tournament-based A/B testing. Prompts improve automatically over time through LLM-as-judge evaluation
- **3 prompt MCP tools** — `prompt.compile` (assemble prompt from genes), `prompt.champion` (get best variant), `prompt.evolve` (run evolution rounds with auto-promotion). AI agents can now optimize prompts programmatically
- **3 prompt MCP resources** — `kai://prompt/{task}` (compiled prompt), `kai://prompt/champion/{task}` (current champion), `kai://prompt/evolution-history/{task}` (promotion audit trail)
- **`kai prompt` CLI** — 9 subcommands for managing genes, genomes, champions, evolution, and tournament history. Use `kai prompt evolve --task planner --rounds 3` to start optimizing
- **GeneStore CRUD** — full database layer for all 8 prompt genome tables (genes, genomes, variants, segments, eval cases, tournaments, champions, champion history)
- **PromptCompiler** — assembly pipeline that selects genes by type, matches profile segments, and builds complete prompts with caching and fallback
- **SegmentMatcher** — profile-to-segment matching algorithm that personalizes prompts based on behavioral traits
- **JudgeEngine** — LLM-as-judge evaluation with configurable judges and majority vote for tournament battles
- **TournamentRunner** — pairwise variant battles with judge evaluation and automatic champion promotion
- **PromptEvolver** — mutation generation via LLM, champion promotion, and rollback support
- **V6 database migration** — 8 new tables for the prompt genome system with proper foreign keys, CHECK constraints, and indexes
- **LLMProvider model override** — per-call model parameter via options, enabling different models for evolution vs. judging
- **Derivator gene integration** — derivator now uses gene-based prompts when available, with rule-based fallback
- **Planner compiler injection** — planner receives PromptCompiler via constructor injection
- **121 new tests** across 14 test files — 440 total tests across 59 files

### Changed
- LLMProvider supports per-call model override via options parameter
- Derivator integrates gene-based prompt compilation with transparent fallback to inline rules
- Planner uses PromptCompiler for profile-aware prompt generation

### Added
- **Orchestrator idea-to-execution engine** — submit ideas, decompose into tasks, schedule, dispatch, observe results, and detect behavioral changes in a closed loop. Use `kai_idea_submit` to start
- **7 orchestrator MCP tools** — `kai_idea_submit`, `kai_idea_plan`, `kai_plan_approve`, `kai_task_execute`, `kai_idea_pause`, `kai_execution_status`, `kai_replan`. AI agents can now plan and execute work on your behalf
- **Profile-aware planner** — LLM-powered task decomposition that adapts to behavioral traits (e.g., early risers get morning schedules). The planner reads your profile to personalize task timing and structure
- **Agent bridge** — Hermes file-based integration for dispatching one-off and cron tasks to external agents
- **Observer pipeline** — execution results automatically become profile observations, so your profile evolves as tasks complete
- **Idea clustering** — auto-groups related ideas from observation patterns using TF-IDF tokenization, so you can see themes across your work
- **Closed loop engine** — when your behavioral traits shift significantly, the engine triggers automatic re-planning of active ideas
- **V5 database migration** — `ideas`, `planned_tasks`, `execution_results` tables; removes source CHECK constraint
- **`execution_result` source type** — observations can now originate from orchestrator execution, appearing alongside cron and MCP sources
- **LLM max_tokens override** — provider accepts optional `max_tokens` parameter for controlling response length
- **319 tests** across 46 files (+93 new tests since v0.3.0.0)

### Changed
- `Observation.source` type union now includes `"execution_result"`
- Observer `getProfileUpdates` returns current trait state (removed misleading oldValue/newValue fields)
- Planner validates LLM-generated agent names against an allowlist
- Error responses from MCP handlers no longer expose internal error details
- Plan approve handler validates task field updates against an explicit allowlist and cron schedule format
- LLM-generated task prompts capped at 2000 characters; feedback capped at 2000
- Planner prompt uses delimiter markers to separate user input from system context
- Observer `processAllResults` pre-fetches idea and tasks to eliminate N+1 DB queries
- Clustering uses single batch query instead of 3 separate status lookups
- Store list methods accept optional `limit` parameter; execution status uses batch result lookup
- ClosedLoopEngine constructed once per handler registration (not per-request)
- Magic numbers extracted to named constants across clustering, closed-loop, observer, planner, scheduler

### Security
- Dynamic task field updates now validated against explicit allowlist (prevents arbitrary column writes)
- Cron schedule values validated against format regex before persistence
- Prompt injection mitigated with delimiter markers and anti-exfiltration system instruction

## [0.3.0.0] - 2026-05-20

### Added
- **`kai work start`** — interactive cold start flow that bootstraps a behavioral profile from 4 questions + git history scan, with preview/edit/confirm cycle
- **`kai profile diff --last`** — see how your profile evolved since the last cold start
- **Workspace system** — CRUD for workspaces, tasks, and events with SQLite persistence (MIGRATION_V4)
- **Event bus** — converts workspace state changes into profile observations with confidence mapping
- **Source precedence** — traits now respect source priority: declared > corrected > observed > inferred, so `kai profile declare` values can't be overwritten by derived ones
- **7 coldstart derivation rules** — detail_oriented, comm_style, domain_context, preferred_output_shape, early_riser, scope_appetite, task_completion_rate
- **Git history scan** — auto-detects work patterns (commit times, message length, branch naming) from the last 30 days
- **226 tests** across 33 files (+73 new tests since v0.2.1.0)

### Changed
- `kai profile bootstrap` is now deprecated — use `kai work start` instead
- `Observation.source` type union now includes `"coldstart"` and `"workspace"`
- `deriveFromRules(persist)` supports preview mode (persist=false) for the cold start confirm flow

### Fixed
- Git timestamp parsing now correctly extracts hours from ISO 8601 format (`T`-prefixed)
- `extractColdStartSignals` guards against divide-by-zero when answers array is empty
- Edit prompts validate numeric input to prevent NaN from reaching SQLite

## [0.2.1.0] - 2026-05-19

### Added
- **GitHub Actions CI** — automated typecheck, lint, and test on every push and PR
- **Dependabot** — weekly dependency updates for GitHub Actions and Bun packages
- **typecheck script** (`bun run typecheck`) — runs `tsc --noEmit` for type safety
- **lint script** (`bun run lint`) — runs Biome on `src/` for code quality
- **.bun-version** — pins Bun version (1.3.13) for reproducible CI builds
- **.npmrc** — ensures lockfile resolves against npmjs.org (not mirrors) for CI reliability

### Changed
- Dependabot ecosystem set to `bun` (not `npm`) for correct lockfile handling
- CLAUDE.md now includes skill routing rules and health stack commands for contributors
- TODO 3 (CI pipeline) marked as completed; TODO 6 (CD release flow) added

## [0.2.0.0] - 2026-05-19

### Added
- **MCP Server** — connect AI agents to Kai via Model Context Protocol. Run `kai mcp serve` to start the stdio server
- **5 MCP tools**: `profile.read` (identity/traits/summary/full scopes), `profile.why` (trait provenance), `observe.submit` (with rate limiting and dedup), `observe.batch` (bulk submit), `derive.trigger` (rules/llm/both methods)
- **6 MCP resources**: `kai://profile/identity`, `kai://profile/traits`, `kai://profile/traits/{dimension}`, `kai://profile/observations/recent`, `kai://profile/summary`, `kai://system/health`
- **Persistent trait corrections** — corrected traits survive re-derivation. No more reappearing after `kai profile derive`
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
