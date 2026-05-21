# How the Prompt Genome System Works

The prompt genome system optimizes Kai's LLM prompts through evolutionary A/B testing. Instead of hand-tuning prompts, you let the system generate variants, test them against each other, and automatically promote the best performers.

## The problem

Kai uses LLM prompts for three tasks: the planner (decomposing ideas into tasks), the derivator (deriving traits from observations), and the observer (converting execution results into observations). Each prompt needs to:

- Produce valid JSON matching the expected schema
- Adapt to the user's behavioral profile (e.g., schedule morning tasks for early risers)
- Avoid exposing raw profile data in outputs

When a prompt produces bad output (invalid JSON, missed profile context, leaked data), the downstream system breaks silently or loudly. Hand-tuning a prompt is slow, subjective, and hard to regression-test. Change one instruction and you might break another use case.

The prompt genome system solves this by treating prompt optimization as a search problem: generate variants, evaluate them automatically, and keep the winners.

## The architecture

```
                      ┌─────────────────────────────────────────┐
                      │           Evolution Loop                 │
                      │                                         │
  Genes ──► Genome ──►│  Mutate ──► Variant ──► Tournament      │
     │                │                          │    │         │
     │                │                     Eval Cases  Judge   │
     │                │                          │    │         │
     │                │                     Battle Results      │
     │                │                          │               │
     │                │                    ┌─────▼─────┐        │
     │                │                    │ Champion? │        │
     │                │                    │ ≥60% win  │        │
     │                │                    │ rate, ≥5  │        │
     │                │                    │ battles   │        │
     │                │                    └──┬─────┬──┘        │
                      │                 promote  no change     │
                      └─────────────────┬───────┬─────────────┘
                                        │       │
                                        ▼       ▼
  Profile ──► Segment ──► Compiler ──► Champion Variant ──► LLM call
  Traits       Matcher      │
                            │
                      Fallback prompt
                      (if no genome/variant)
```

### Genes

A gene is a reusable prompt fragment tagged by function. Five types:

| Type | Purpose | Example |
|------|---------|---------|
| `intent` | What the prompt should accomplish | "Decompose ideas into 3-8 actionable tasks" |
| `contract` | Output format requirements | "Return JSON with tasks array, each has title, description..." |
| `adapter` | Profile interpolation | "User has {{trait:early_riser}} = 0.85, schedule morning tasks" |
| `example` | Few-shot demonstrations | "Input: 'build a blog', Output: {tasks: [...]}" |
| `tone` | Voice and style | "Be concise, use active voice" |

Adapter genes use `{{trait:dimension}}` placeholders that get replaced with actual trait values at compile time, weighted by confidence. This is how prompts adapt to individual profiles.

### Genomes

A genome is an ordered list of gene IDs for a task. One genome per task (`planner`, `derivator`, `observer`). The compiler assembles genes in order, joining them with double newlines.

### Segments

Segments are profile-based partitions. Each segment defines trait constraints (min/max values for specific dimensions). The `SegmentMatcher` checks the user's traits against segment constraints and picks the best match. If fewer than 3 traits have confidence ≥ 5, the system falls back to the `default` segment.

This means different user profiles can get different prompt variants. An early riser with high detail orientation matches a different segment than a night owl who prefers breadth.

### Variants

A variant is a compiled prompt string produced by assembling a genome. Variants track their lineage: generation number, parent variant, and mutation type. The evolution loop creates new variants by asking the LLM to rephrase intent or contract genes.

### Tournaments

A tournament is a pairwise battle between two variants on a single eval case. The flow:

1. Both variants receive the eval case input as a prompt
2. The LLM generates outputs for both
3. A judge (also an LLM) compares the outputs on four criteria:
   - **OUTPUT_CONTRACT** (gate): Does the output match the required JSON schema? If one fails and the other passes, the passing one wins immediately.
   - **PROFILE_ALIGNMENT** (weight 0.3): Does the output use the user's profile appropriately?
   - **TASK_QUALITY** (weight 0.5): Is the decomposition/derivation high quality?
   - **SAFETY** (weight 0.2): Does the output avoid exposing raw profile data?

The judge uses a 3-call majority vote to reduce variance from LLM-as-judge randomness. At least 2 of 3 calls must agree.

### Champions

A champion is the best-performing variant for a task + segment. Only one champion per task/segment pair. Promotion requires:

- Win rate ≥ 60% (wins + half-ties divided by total battles)
- At least 5 battles

When a new champion is promoted, the previous champion is recorded in the history table with a demotion reason. You can rollback to the previous champion unless the current one is locked.

## Trade-offs

**LLM cost per evolution round.** Each round runs N × M battles (N variant pairs × M eval cases), each requiring 3 LLM calls (generate output A, generate output B, judge comparison × 3 for majority vote). A round with 4 variants and 10 eval cases costs roughly 4 × 10 × 5 = 200 LLM calls. The default model is `gpt-4o-mini` to keep costs low.

**Judge subjectivity.** LLM-as-judge is not ground truth. The majority vote (3 calls) reduces variance but doesn't eliminate it. Eval cases with expected outputs help, but the judge's quality criteria are subjective. This is a known trade-off: cheaper than human evaluation, less reliable.

**Cold start.** The system needs genes and eval cases seeded before evolution can run. Without them, it falls back to hardcoded prompts. The first setup requires manual seeding.

**Segment granularity.** Segments only activate when a profile has 3+ high-confidence traits. New or sparse profiles always get the default segment. This prevents over-fitting to noisy profile data.

## Design decisions

**Why 5 gene types?** The types map to distinct prompt engineering concerns: what to do (intent), what format to use (contract), how to adapt (adapter), what examples to show (example), and how to sound (tone). This separation lets the evolver mutate one concern without affecting others.

**Why majority vote (3 calls)?** A single LLM judgment has high variance. Three calls with majority vote reduces false positives (a bad variant winning by luck). The cost is 3x per judgment, but since we use `gpt-4o-mini`, this is acceptable.

**Why 60% win rate threshold?** Below 50% is clearly worse. 50-60% is noise. 60%+ is a meaningful signal that one variant consistently outperforms the other. The 5-battle minimum prevents a variant from being promoted after a single lucky tournament.

**Why fallback prompts?** The system must always produce a working prompt, even with zero genes or a corrupted database. The hardcoded fallback prompts in `prompt-compiler.ts` are the safety net. They match the original prompts that shipped before the genome system existed.

**Why cache compilation?** Profile traits change slowly (only when derivation runs). Caching compiled prompts keyed by task + segment + trait hash avoids redundant LLM calls between evolution rounds. The LRU cache holds 100 entries.

## Alternatives considered

**Single monolithic prompt per task.** The original approach. Simple but impossible to evolve incrementally — changing one part of a long prompt affects everything. The gene-based approach isolates mutations to specific concerns.

**RLHF (Reinforcement Learning from Human Feedback).** More principled but requires a reward model, human annotations, and significantly more infrastructure. The tournament approach is simpler and works with any LLM API.

**Deterministic eval (regex/schema-only).** Checking output format is necessary but not sufficient. A prompt that always produces valid JSON but ignores the user's profile is worse than a prompt that sometimes produces invalid JSON but nails the profile. The LLM-as-judge catches quality issues that schema validation misses.

## Related

- [How to Run Prompt Evolution](howto-prompt-evolution.md) — step-by-step walkthrough
- [CLI Reference](reference-cli.md) — `kai prompt` commands
- [MCP Server Reference](reference-mcp-server.md) — prompt tools and resources API
- [Database Schema Reference](reference-database.md) — prompt genome tables (V6 migration)
