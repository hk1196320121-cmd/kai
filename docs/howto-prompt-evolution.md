# How to Run Prompt Evolution

Optimize Kai's LLM prompts through automated A/B testing. The prompt genome system generates prompt variants, battles them in tournaments, and promotes the best performers as champions.

## Prerequisites

- Kai installed and configured (see [How to Configure Kai](howto-configure.md))
- LLM API key set (`LLM_API_KEY` environment variable)
- At least one task with eval cases in the database. Tasks: `planner`, `derivator`, `observer`

## Check Current State

Before evolving, see what you have:

```bash
# Check if genes exist for a task
kai prompt gene list --task planner

# Check current champion
kai prompt champion show --task planner

# Check past tournament results
kai prompt tournament results --task planner --last 5
```

If `gene list` returns "No genes found", you need to seed genes first. The system requires eval cases and a genome before evolution can run.

## Run a Single Evolution Round

```bash
kai prompt evolve --task planner
```

This runs one round: generates 2 mutant variants, battles them against existing variants in pairwise tournaments, and checks if any variant meets the promotion threshold (60% win rate over 5+ battles).

Output:
```
Evolving planner (segment: default, model: gpt-4o-mini, rounds: 1)...
  Battles run: 4
  Champion promoted: false
```

## Run Multiple Rounds

```bash
kai prompt evolve --task planner --rounds 3
```

Each round generates new mutants and runs fresh tournaments. More rounds give variants more chances to distinguish themselves. Each round prints its battle count and promotion status.

## Auto-Approve Champion Promotion

By default, a variant that meets the promotion threshold is reported but not automatically promoted. Use `--auto` to promote immediately:

```bash
kai prompt evolve --task planner --rounds 5 --auto
```

Output when a champion is promoted:
```
  Champion promoted: true
  New champion: a1b2c3d4
  Previous:     e5f6g7h8
```

## Use a Different Model

The default model is `gpt-4o-mini`. Override it for generation and judging:

```bash
kai prompt evolve --task derivator --model gpt-4o
```

The model is used for both generating mutant variants and running the LLM-as-judge evaluation.

## Manage Champions

```bash
# Show champion across all segments
kai prompt champion show --task planner --all-segments

# Lock the current champion (prevents rollback)
kai prompt champion lock --task planner

# Rollback to the previous champion
kai prompt champion rollback --task planner
```

Locking is useful when you've verified a champion produces good results and want to prevent accidental demotion.

## View Tournament History

```bash
# Last 10 tournaments (default)
kai prompt tournament results --task planner

# Last 50
kai prompt tournament results --task planner --last 50
```

Each row shows the variant IDs, winner, judge confidence, and timestamp.

## Compile a Prompt

After evolution, compile the current best prompt for a task:

```bash
kai prompt genome compile --task planner
```

Output:
```
=== Compiled Prompt (planner) ===
Genome:  abc123...
Segment: default
Variant:  def456...
Genes:   5
Cached:  false

--- Prompt ---

You are a task decomposition engine...
```

Use `--json` for machine-readable output.

## How It Works

The evolution loop:

1. **Generate mutants** — takes the current genome's genes and asks the LLM to rephrase intent and contract genes
2. **Create variants** — the rephrased genes are assembled into new compiled variants
3. **Run tournaments** — every variant pair is evaluated against eval cases using the LLM-as-judge (3-call majority vote)
4. **Check promotion** — if any variant wins 60%+ of its battles over 5+ matches, it becomes the new champion
5. **Repeat** — each round adds more battle data, giving better statistical signal

## Troubleshooting

**"No genes found"** — The prompt genome system needs genes seeded in the database. Check with `kai prompt gene list`. If empty, the system falls back to hardcoded prompts.

**"No genome found for task"** — No genome assembly exists for this task. The system uses fallback prompts when no genome is available.

**"no eval cases in pool"** — Tournament battles need eval cases (test inputs) to evaluate variants against. Without eval cases, evolution has nothing to judge.

**"need at least 2 variants"** — The first evolution round needs a genome with at least 2 variants. Mutations create new variants, so this resolves after genes exist.

**Champion not promoted after many rounds** — The promotion threshold is 60% win rate over 5+ battles. If mutants aren't consistently beating the current champion, the champion is already well-optimized. Consider adding more diverse eval cases.

## Related

- [Prompt Genome Architecture](explanation-prompt-genome.md) — why genes, segments, and tournaments work this way
- [CLI Reference](reference-cli.md) — complete `kai prompt` command reference
- [MCP Server Reference](reference-mcp-server.md) — `prompt.compile`, `prompt.champion`, `prompt.evolve` API
