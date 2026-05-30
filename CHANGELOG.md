# Changelog

## [0.12.1] - 2026-05-30

### Added
- **Autopilot hook system** — three lifecycle hooks (SessionStart, PostToolUse, Stop) that observe your work style and derive behavioral traits automatically between sessions
- **AutopilotManager** — installs/uninstalls/hooks status for the autopilot system, writing scripts and merging settings.json
- **`kai hooks install/uninstall/status`** — CLI commands to manage hook scripts and settings registration
- **`kai autopilot status`** — CLI command showing session history and active session info
- **Session tracking** — SessionStart hook creates a session marker in `autopilot_sessions` table; Stop hook closes it with derivation stats
- **Nudge system** — SessionStart generates behavior-adaptive nudges based on top traits (autonomy, detail orientation, disliked behaviors)
- **Stop hook derivation** — runs `deriveFromRulesCore` at session end to update traits from accumulated observations
- **5 new derivation rules** — autonomy/Bash, detail_oriented/Edit, exploratory/Search, code_focus/Code, planning_style/Todo
- **Orphan session cleanup** — stale pending sessions (>1 hour) auto-closed on next session start
- **30-day observation retention** — Stop hook prunes observations older than 30 days
- **Schema version gates** — all hooks check minimum schema version before executing, preventing errors on un-migrated databases
- **Migration V9** — expands observations CHECK constraints, adds `session_id` FK column, creates `autopilot_sessions` table with down-migration support
- **DB permission hardening** — database files set to 0o600 (owner-only read/write)
- **Shared constants** — `MIN_SCHEMA_VERSION`, `ALLOWED_TOOLS`, `BUSY_TIMEOUT_MS` in single source-of-truth module for cross-hook consistency

### Changed
- **Auto-observe hook rewritten** — fixed P0 bugs (invalid `type=tool_pattern`, string confidence), added session_id FK, privacy allowlist, and schema version gate
- **SessionStart hook upgraded** — added nudges, session tracking, cold-start detection, orphan cleanup, and profile read with identity
- **derive-shared module** — extracted `deriveFromRulesCore` for use by both Derivator and Stop hook, with transactional trait persistence and confidence clamping
- **PostToolUse matcher removed** — allowlist filtering now happens inside the hook script, not via settings.json matcher

### Fixed
- **P0 auto-observe regression** — `type=tool_pattern` violated CHECK constraint, `confidence=0.6` (string) violated INTEGER CHECK. Both silently failed since v0.12.0
- **Confidence clamping** — both `derive-shared.ts` and `derivator.ts` now clamp confidence to [1, 10] preventing silent DB write failures
- **Transactional trait persistence** — `persistTraits` now wraps all upserts in a single transaction, preventing partial writes on crash

## [0.12.0.0] - 2026-05-29

### Added
- **Multi-platform skills support** — `kai skills install --target <platform>` now installs skills into Claude Code, Gemini CLI, or Hermes with platform-appropriate MCP configuration (JSON for Gemini, YAML for Hermes). Auto-detects installed tools when `--target` is omitted
- **TargetRegistry** — centralized target platform discovery, validation, and adapter resolution with `detectPlatforms()` auto-detecting installed AI tools
- **GeminiCliTarget adapter** — installs skills and configures MCP via Gemini CLI's `settings.json` (JSON format)
- **HermesTarget adapter** — installs skills and configures MCP via Hermes YAML config
- **MCP config utilities** — shared `configureMcpInConfig`, `removeMcpFromConfig`, and `validateMcpInConfig` with atomic writes for both JSON and YAML formats
- **Skill manifest validation** — `validateSkillManifest()` utility for atomic manifest reads/writes
- **`kai skills list --target`** — list installed skills across any platform, auto-detecting or filtering by target
- **28 new tests** for multi-platform coverage including registry, adapters, MCP config, and edge cases

### Fixed
- **doctor exits non-zero on MCP validation failure** — `runDoctorForTarget` now returns false when MCP validation fails, so CI gates work correctly
- **readConfig eliminates double-read** — JSON config reads now resolve realpath once instead of reading the file twice
- **atomicWrite cleans up .tmp files** — `atomicWriteJson`/`atomicWriteYaml` now clean up temp files on write failure
- **installToTarget recursion guard** — prevents infinite loop when manifest target mismatches after force reinstall
- **mcp-config rejects invalid types** — throws error instead of silently replacing non-object `mcpServers` entries

## [0.11.0.0] - 2026-05-28

### Added
- **8 workflow slash commands** (`/kai`, `/kai-profile`, `/kai-observe`, `/kai-why`, `/kai-plan`, `/kai-status`, `/kai-reflect`, `/kai-evolve`) — workflow definitions that map natural-language intents to MCP tool calls with profile-aware conditional content
- **CommandGenerator** — compiles WorkflowDefinition schemas into Claude Code slash command markdown files with PII-safe trait baking (14 behavioral dimensions whitelisted, identity fields excluded)
- **Hook generators** for SessionStart (profile injection into new sessions) and PostToolUse (auto-observe tool usage patterns with pattern detection and observation submission)
- **Install generates commands + hooks** — `kai skills install` now writes workflow commands to `~/.claude/commands/kai/`, hook scripts to `~/.claude/hooks/kai/`, and merges hook registrations into `~/.claude/settings.json`
- **Doctor validates commands + hooks** — `kai skills doctor` now checks workflow command files, hook scripts, and settings.json hook registration status
- **Uninstall removes commands + hooks** — `kai skills uninstall` now cleans up `~/.claude/commands/kai/`, `~/.claude/hooks/kai/`, and removes hook registrations from settings.json
- **OI-1 intent-based triggers** — overlapping domains (e.g., observe vs derive) use intent keywords for disambiguation instead of domain-only matching
- **Tag-triggered release workflow** — CI releases triggered by `kai-profile-v*` tags instead of release-please

### Changed
- **Hook script generators extracted** — `generateSessionStartHook` and `generateAutoObserveHook` moved to `hooks/session-start.ts` and `hooks/auto-observe.ts` for maintainability
- **Doctor reuses isKaiHook()** — settings.json hook validation now uses the shared detection function instead of duplicated inline logic
- **WorkflowStep and ProfileCondition exported** — types now accessible for downstream consumers
- **Profile load failure logs warning** — install command now distinguishes "profile unavailable" from "profile is empty"

### Fixed
- **Biome lint warnings** resolved across skills module
- **rmSync typo** — `true: true` corrected to `force: true` in coverage tests

## [0.10.1.0] - 2026-05-28

### Changed
- **DB migration extraction**: 8 migration SQL strings moved from `db/client.ts` to `db/migrations/v1-v8.ts` with a declarative registry (`db/migrations/index.ts`) that enforces sequential ordering and self-bumps cross-validation at import time
- **MCP handler decomposition**: `handlers.ts` (384 lines) split into 3 domain files (`handlers/profile.ts`, `handlers/observe.ts`, `handlers/derive.ts`) with factory-pattern dependency injection; `orchestrator-handlers.ts` (324 lines) split into `orchestrator/ideas.ts`, `orchestrator/tasks.ts`, `orchestrator/planning.ts` + `orchestrator/utils.ts`
- **Profile derivator decomposition**: `derivator.ts` (523 lines) split into `core/profile/rules.ts` (rule definitions), `core/profile/llm-derive.ts` (LLM derivation logic), and a thin `derivator.ts` facade (118 lines)
- **Shared MCP utilities**: `textContent()`, `withTrace()`, and `safeJsonParse()` extracted to `mcp/utils.ts`

### Fixed
- **Tab characters in fallback prompt**: removed non-printable characters that could cause LLM parsing errors
- **Biome import ordering**: fixed import sorting across new derivator modules

## [0.10.0.1] - 2026-05-27

### Added
- **Dynamic Skill Compiler**: introspects Kai's 19 MCP tool schemas via Zod and generates SKILL.md files for Claude Code, letting users invoke tools via slash commands like `/kai-profile`, `/kai-work`, `/kai-idea` instead of remembering MCP tool names
- **CLI commands**: `kai skills install`, `kai skills list`, `kai skills doctor`, `kai skills uninstall` — full install/validate/remove lifecycle for generated skill files
- **7 domain skill files** (profile, observe, derive, work, idea, prompt, telemetry) plus a master `/kai` command palette — run `kai skills install` to generate them
- **Target adapter interface**: pluggable target system with Claude Code adapter (atomic JSON writes, MCP config management) — add new targets without touching the compiler
- **632 new tests** (922 total): compiler unit tests, template snapshot tests, target adapter tests, integration flow

### Changed
- **CLAUDE.md / AGENTS.md**: GitNexus index stats updated (3901 symbols, 8532 relationships, 161 execution flows)
- **`TOOL_DOMAIN_MAP` and `DOMAIN_RESOURCES`**: reduced to module-private — only the public API is exported

### Fixed
- **Slash commands, resources, and skill names**: aligned with CEO plan specifications
- **CLI wiring, permissions, and MCP config flow**: addressed Codex review findings
- **Lint issues**: import sorting, formatting, unused variables

## [0.9.1] - 2026-05-26

### Changed
- **work.ts decomposed into 6 focused modules**: git-scan.ts (git history analysis), ui.ts (progress/display), status.ts (workspace status/list), recommendations.ts (idea recommendations + penalization), start.ts (lifecycle orchestration with PhaseResult control flow), types.ts (shared interfaces). work.ts is now a 35-line facade
- **SIGINT handling rewritten with cooperative cancellation**: Ctrl+C during `kai work start` now gracefully closes the interview, cleans up workspaces, and exits cleanly instead of abruptly terminating
- **Coldstart cleanup centralized**: single deleteColdstartObservations() helper replaces scattered SQL DELETE calls
- **Reasoning display constants**: magic numbers 60/57 replaced with REASONING_DISPLAY_LIMIT/REASONING_SLICE_LENGTH

### Fixed
- **Invalid recommendation input no longer penalizes all traits**: only explicit 'n'/'no' triggers penalization (ISSUE-001). Gibberish or empty input is a no-op
- **Restart/abort cleans coldstart observations**: finally block deletes coldstart data on abort so next run gets a fresh slate (ISSUE-003)
- **Re-run preserves existing profile data**: checkRerun abort path now sets completed=true, preventing finally block from deleting coldstart data that already existed
- **SIGINT double-registration guard**: re-registration after interview checks if listener is already registered before adding
- **Lint cleanup**: removed unused GitScanResult re-export, dead imports

### Added
- **869 tests** (up from ~800): pre-refactor lifecycle tests, post-extraction module tests, SIGINT behavior validation, coverage tests for git-scan/recommendations/ui/start
- **GitNexus skills**: exploring, impact-analysis, debugging, refactoring, guide, CLI — indexed with 3583 symbols, 7937 relationships
- **Plan file**: 64-step decomposition plan with checkbox tracking

## [0.9.0] - 2026-05-25

### Changed
- **Version format migration**: 4-part semver (0.8.0.0) → 3-part semver (0.9.0) for release-please compatibility
- **Package name**: `kai` → `kai-profile` for npm publishing
- **Version strings**: CLI and MCP server now read version dynamically from package.json (with graceful fallback)
- **Build script**: Added `tsc` build step, `dist/` is the compiled output directory
- **CLI description**: Auto-synced from package.json instead of hardcoded
- **prepublishOnly**: Changed to `tsc` (works without bun installed)
- **Release workflow hardened**: Pinned actions to commit SHAs, job-scoped permissions, CI poll loop gate

### Added
- **CD release pipeline**: Kai is now available on npm as `kai-profile`. Install with `bunx kai-profile` or `bun add -g kai-profile`. Releases are automated via release-please versioning, npm publish after CI passes, and a smoke test verifying the published package
- **Build verification tests**: Artifact existence, shebang preservation, npm pack whitelist, version consistency
- **CD pipeline tests**: Package metadata validation, dynamic version verification, error path coverage

### Fixed
- **CI race condition**: Release publish now waits for CI to complete (poll loop, 10min timeout)
- **Release gate safety**: Explicit `== 'true'` string comparison prevents accidental publishes
- **Smoke test accuracy**: Verifies `--version` output matches expected version instead of just `--help`
- **Stale build artifacts**: `dist/` cleaned before every build in release workflow
- **Supply chain**: All GitHub Actions pinned to immutable commit SHAs

## [0.8.0.0] - 2026-05-24

### Added
- **Shared formatting layer** (`format.ts`) — 16 primitives for consistent CLI output: `header`, `subheader`, `kv`, `bar`, `section`, `status`, `table`, `list`, `dim`, `emphasis`, `renderError`, `divider`, `nextSteps`, `shouldUseColor`, `getTerminalWidth`. Handles NO_COLOR env, non-TTY detection, ANSI-aware padding, and edge cases (NaN/Infinity/negative in bar charts)
- **Profile renderer** — structured identity display, trait bars with confidence indicators, profile diffs with direction labels and confidence deltas, provenance with observation links
- **Prompt renderer** — champion gene display, gene list with truncation, tournament results table
- **Recommendations renderer** — scored recommendation cards with explanations, optional hint suppression
- **Telemetry renderer** — health dashboard, nested trace spans with cycle detection, error list with truncation
- **Workspace renderer** — workspace status with progress indicators, workspace list with task counts
- **`--no-color` global flag** — disables all ANSI color output, respects NO_COLOR env and non-TTY
- **Progress indicators on stderr** — `progress()`/`progressDone()` for non-TTY-friendly status during long operations
- **Comprehensive test coverage** — 522 format tests, 431 profile renderer tests, 255 prompt renderer tests, 305 telemetry renderer tests, 213 workspace renderer tests, 123 recommendation renderer tests, 51 color verification tests, 58 JSON bypass tests

### Changed
- All CLI commands migrated from ad-hoc `console.log` to typed renderers for consistent formatting
- `kai profile read/why/diff` use profile renderer for structured output
- `kai prompt champion/genes/tournament` use prompt renderer
- `kai telemetry health/trace/errors` use telemetry renderer with nested span visualization
- `kai work list` shows task progress (completed/total) per workspace
- `kai work start/recommend` suppress selection hints when not accepting input
- Empty catch blocks replaced with silent fallbacks where errors are expected (detached HEAD, malformed JSON)

### Fixed
- **Infinite recursion in telemetry trace** — circular span references no longer crash the CLI
- **Bar chart division by zero** — `bar(value, {max: 0})` returns empty bar instead of NaN crash
- **Commander `--no-color` option** — correctly reads `opts.color` (not `opts.noColor`)
- **Confidence delta in profile diff** — changed traits now show confidence change (`+1`, `-4`, etc.)

## [0.7.0.0] - 2026-05-23

### Added
- **InterviewEngine** — cold start now asks 10 interview questions (planning style, schedule rhythm, output preferences, risk tolerance, autonomy, domain focus) instead of the old 4-question flow. Each answer maps directly to a trait dimension, producing richer profiles on first run
- **Template catalog + recommendation engine** — after the interview, Kai recommends task templates matched to your profile traits. 12 templates across 6 domains, scored by trait alignment
- **`kai_work_recommend` MCP tool** — AI agents can request task recommendations by domain via `kai_work_recommend`. Returns top-3 with explanations for why each fits the user's profile
- **Recommendation feedback loop** — rejected recommendations emit `recommendation_rejected` events and reduce confidence of the trait dimensions that drove the recommendation (floor at 1)
- **`deriveFromValues` rule interface** — derivator rules can now define explicit answer-to-value mappings instead of relying on observation counts. 7 new rules: `planning_style`, `schedule_rhythm`, `preferred_output_shape`, `disliked_behavior`, `risk_tolerance`, `autonomy`, `domain_context`
- **`--reset` flag** for `kai work start` — forces a fresh interview even if cold start was already completed
- **Re-run detection** — skips interview on subsequent runs, shows recommendations from existing profile
- **Multi-select approval** — approve all, pick one by number, or skip recommendations
- **Auto-execute** — approved recommendations create ideas, decompose via LLM (with single-task fallback), and auto-dispatch via HermesAgentBridge
- **V8 database migration** — extends `workspace_events` with `recommendation_shown`, `recommendation_accepted`, `recommendation_rejected`, and `task_auto_executed` event types

### Changed
- `work.ts` refactored from flat signal extraction to InterviewEngine-driven 10-question flow with recommendations and auto-execution
- `Derivator.deriveFromRules()` prefers `deriveFromValues` when available, falls back to count-based `derive`
- Domain detection prioritizes explicit interview answers over keyword heuristics, with dedup guard
- `IdeaDomain` type and Zod schema extended with "management" domain
- `Recommendation` interface now carries `traitTargets` for feedback loop integration

### Fixed
- `coldstart:format` slug corrected to `coldstart:preferred_output_shape` for consistency with derivator rules
- JSON parse for domain observations wrapped in try/catch to handle malformed data gracefully
- V8 migration schema version INSERT moved inside the transaction for atomicity

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
