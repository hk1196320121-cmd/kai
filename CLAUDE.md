# Kai

Intelligent task orchestration and personal assistant system. TypeScript + Bun + SQLite.

## Commands

- `bun test` — run all tests (88 tests, 13 files)
- `bun run src/cli/index.ts <command>` — run CLI
- `bun run src/cli/index.ts profile bootstrap` — interactive first-time setup

## Architecture

- `src/cli/` — Commander.js CLI (profile, observe subcommands)
- `src/core/profile/` — Profile Engine (engine, collector, derivator, decay, provenance)
- `src/bridge/hermes.ts` — reads cron outputs from filesystem
- `src/db/client.ts` — SQLite with WAL mode, schema + migrations
- `src/llm/provider.ts` — OpenAI-compatible LLM provider

## Key Patterns

- Observations have SHA-256 dedup, CHECK constraints on source/type enums
- Confidence scale: MCP-facing uses 0-1 float, internal uses 1-10 integer
- Trait derivation: rule-based (early_riser, tinkerer, consistent_user) + LLM inference
- Provenance chain on every trait — `profile why <dimension>` shows evidence

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
