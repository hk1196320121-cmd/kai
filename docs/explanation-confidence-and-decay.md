# Confidence Scales, Decay, and Corrections

Why Kai uses two confidence scales, why traits decay, and how corrections persist across re-derivation.

## The problem

Kai receives behavioral data from two sources: MCP tools (used by AI agents) and CLI commands (used directly). These systems measure confidence differently. AI agents think in probabilities (0–1). The profile engine thinks in discrete levels (1–10). Without a bridge, every observation would need manual conversion.

Traits also change over time. "Early riser" derived from last week's data may not be accurate if the user switched to night shifts. Without decay, traits become stale. Without corrections, wrong traits reappear every time derivation runs.

## Two confidence scales

MCP tools accept confidence as a float from 0 to 1. Internal storage uses integers from 1 to 10. The conversion happens automatically in `mcp-scale.ts`:

```
internal = round(mcp × 9) + 1
mcp = (internal - 1) / 9
```

**Why two scales?** MCP's 0–1 scale is standard for probability and works well with LLM outputs (which often express confidence as percentages). The internal 1–10 scale gives more granularity for trait comparison and decay calculations. 10 levels is enough to distinguish between "very low" and "low" without false precision.

**Why not just pick one?** MCP compatibility requires the 0–1 scale. The profile engine was designed before MCP support existed, using 1–10. Changing either would break existing data or the MCP contract. The conversion layer costs nothing and preserves both ecosystems.

## Confidence decay

Traits lose confidence over time unless reinforced by new observations. The decay function reduces confidence by a fixed amount per day since the last observation that contributed to the trait.

Declared traits (set directly by the user via `kai profile update`) are immune. They represent explicit preferences, not inferred behavior.

**Why decay?** Without it, a trait derived from observations in January would carry the same weight in June, even if the user's behavior completely changed. Decay ensures the profile reflects recent behavior, not historical artifacts.

**The trade-off:** Aggressive decay makes the profile responsive to change but can lose stable traits during gaps (vacation, illness). Conservative decay keeps stable traits but lags behind real changes. Kai's current decay rate is tuned for weekly observation patterns — a trait with no reinforcement for ~30 days drops significantly.

**How it works:** `kai profile decay` is a manual CLI command, not automatic. The user decides when to apply decay. This prevents surprise confidence drops during active use periods.

## Persistent corrections

When a user corrects a trait (`kai profile correct <dimension>` or `profile.why` returning incorrect data), the correction is stored in a `corrections` table with the dimension name, reason, and timestamp.

The derivator checks this table before deriving traits. If a dimension has an active correction, the derivation rule skips it entirely. The trait won't reappear.

**Why persist corrections?** Before v0.2.0.0, corrections only removed the trait. Running `derive` again would recreate it from the same observations. Users had to correct the same trait repeatedly — a frustrating loop.

The corrections table breaks this loop. Once corrected, a dimension stays corrected until the user explicitly removes the correction.

**The trade-off:** Corrections are permanent until manually cleared. If a user corrects "early_riser" but later actually becomes an early riser, the trait won't derive until the correction record is removed from the database. This is intentional — false negatives (missing a real trait) are preferable to false positives (a wrong trait keeps reappearing).

## How they work together

```
Observation → Derive → Trait (confidence 7)
    ↓
  30 days pass, no reinforcement
    ↓
  Decay → Trait (confidence 4)
    ↓
  User says "that's wrong"
    ↓
  Correct → Trait removed, correction stored
    ↓
  Re-derive → Dimension skipped (correction active)
```

The three mechanisms — dual scales, decay, and corrections — handle different failure modes:

| Failure mode | Mechanism |
|-------------|-----------|
| Wrong confidence format | Scale conversion |
| Stale traits | Decay |
| Wrong traits | Corrections |
| Reappearing wrong traits | Persistent corrections |

## Alternatives considered

**Single scale:** Using only 0–1 internally would simplify the code but lose granularity. 10 levels is the minimum for meaningful confidence comparison.

**Automatic decay:** Running decay on every read would keep traits current but makes reads slower and makes debugging harder (confidence changes between reads). Manual decay gives the user control.

**Soft corrections (ignore, don't persist):** Simpler implementation but defeats the purpose. If derive recreates corrected traits, corrections are meaningless.
