# Contributing to Kai

How to set up the development environment, run tests, and submit changes.

## Prerequisites

- [Bun](https://bun.sh) 1.3.13+ (required — Kai uses `bun:sqlite` and `import.meta.main`, which are Bun-specific APIs)
- Git

## Setup

```bash
git clone https://github.com/hk1196320121-cmd/kai.git
cd kai
bun install
```

Verify everything works:

```bash
bun run typecheck   # TypeScript type checking
bun run lint        # Biome linting
bun test            # Run all tests
```

## Development workflow

```bash
# Run CLI commands in dev mode
bun run dev profile read
bun run dev work start
bun run dev mcp serve

# Link globally for testing
bun link
kai profile read
```

## Testing

### Run the full test suite

```bash
bun test
```

### Run specific tests

```bash
bun test tests/core/orchestrator/  # All orchestrator tests
bun test tests/mcp/                # All MCP tests
bun test tests/e2e/                # End-to-end tests
bun test --watch                   # Watch mode
```

### Test tiers

| Tier | Files | What they cover |
|------|-------|-----------------|
| Unit | `tests/core/**`, `tests/bridge/**`, `tests/mcp/**`, `tests/cli/**` | Individual modules in isolation |
| Integration | `tests/mcp/handlers.test.ts`, `tests/mcp/orchestrator-handlers.test.ts` | MCP handler → engine → database flow |
| E2E | `tests/e2e/**` | Full closed-loop flows from CLI to database |

### Test structure

Each test file mirrors the source file it tests: `tests/core/profile/engine.test.ts` tests `src/core/profile/engine.ts`. Tests use Bun's built-in `test()` function with `describe()`/`it()` blocks.

Tests create temporary databases via `:memory:` SQLite or temp files. No external services needed (LLM calls are mocked in unit tests).

## Health stack

Run all checks before submitting a PR:

```bash
bun run typecheck           # tsc --noEmit
bun run lint                # Biome check on src/
bun run build               # Compile TypeScript to dist/
bun test                    # Full test suite
npx knip                    # Dead code detection
```

CI runs these same checks on every push and PR. All five must pass before merge.

## Project structure

```
src/
  autopilot/          AutopilotManager — installs/uninstalls hooks, session tracking, shared derive module
  cli/                Commander.js CLI commands
    cli/renderers/       Typed output renderers (profile, prompt, recommendations, telemetry, workspace)
    cli/work/            Work command modules (start, status, recommendations, git-scan, ui, types)
    cli/skills/          Skill compiler — generates SKILL.md files, workflow commands, and hooks (multi-platform: Claude Code, Gemini CLI, Hermes)
  core/profile/       Profile engine (identity, observations, traits, derivation, decay, interview)
  core/orchestrator/  Idea-to-execution engine (planner, scheduler, dispatcher, observer, recommendations)
  core/prompt/        Prompt genome system (gene-store, compiler, evolver, tournament-runner, judge-engine)
  workspace/          Workspace/task/event CRUD + event bus
  mcp/                MCP server (handlers with domain sub-files, resources, schema, stdio transport)
  bridge/             Hermes bridge (file reads) + agent bridge (task dispatch)
  db/                 SQLite client with WAL mode and schema migrations (v1–v9), with declarative migration registry in db/migrations/
  llm/                OpenAI-compatible LLM provider with retry logic
dist/                Compiled output (tsc), created by bun run build
tests/                Mirrors src/ structure
docs/                 Documentation (Diataxis framework: tutorial/howto/reference/explanation)
```

## Code style

- TypeScript with strict mode
- Linting via Biome (`bun run lint`)
- No unused imports or variables (`knip` catches these)
- Named exports (no default exports)

## Submitting changes

1. Create a feature branch from `master`
2. Make your changes with tests
3. Run the health stack (`typecheck`, `lint`, `test`)
4. Push and create a PR
5. CI must pass before review

## Key concepts

- **Observations** are the raw data. Everything flows from observations to traits.
- **Traits** have source precedence: declared > corrected > observed > inferred. A derived trait cannot overwrite a user-declared one.
- **The orchestrator** is a pipeline: idea → plan → schedule → dispatch → observe → closed-loop re-plan.
- **Database** is SQLite with auto-migrating schema. The current version is v9.

## License

Private project.
