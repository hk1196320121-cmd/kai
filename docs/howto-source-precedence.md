# How Trait Source Precedence Works

Understanding and leveraging the priority system that protects your explicit choices from being overwritten by derived traits.

## Prerequisites

- A Kai profile with at least one trait (run `kai work start` if you don't have one)
- Familiarity with `kai profile read` and `kai profile correct`

## The 4-level priority system

Every trait has a source that determines its priority. When a new value arrives for the same dimension, Kai checks whether the new source outranks the existing one:

| Priority | Source | How it gets set |
|----------|--------|----------------|
| 4 (highest) | `declared` | `kai profile update --field <dim> --value <val>` |
| 3 | `corrected` | `kai profile correct <dimension>` |
| 2 | `observed` | Cold start signals, workspace events |
| 1 (lowest) | `inferred` | Derivation rules, LLM inference |

A trait with source `declared` (priority 4) cannot be overwritten by an `inferred` value (priority 1). The lower-priority value is silently ignored.

## Protect a trait from derivation

After running `kai work start`, suppose the derived `early_riser` trait is 0.6, but you know you're definitely a morning person. Set it directly:

```bash
kai profile update --field early_riser --value 0.9
```

Wait — that command updates identity fields, not traits. For trait-level protection, use the correction mechanism:

```bash
kai profile correct early_riser
```

This removes the trait and records a correction at priority 3. Any future derivation that produces `early_riser` will be blocked because the correction (priority 3) outranks `observed` (priority 2) and `inferred` (priority 1).

## Verify source precedence in action

```bash
# After cold start, see what source each trait has
kai profile read
```

Output shows the source for each trait:

```
Traits (7):
  early_riser: 0.60 (confidence: 6/10, source: observed)
  detail_oriented: 0.80 (confidence: 8/10, source: observed)
  comm_style: 0.70 (confidence: 6/10, source: inferred)
```

The `observed` source means it came from cold start signals (priority 2). The `inferred` source means it came from rule-based derivation (priority 1).

## When precedence blocks an update

Run `kai profile derive` after correcting a trait:

```bash
kai profile correct detail_oriented
kai profile derive
```

The derivation runs, but `detail_oriented` is skipped entirely. The correction (priority 3) blocks re-derivation. Other traits update normally.

## When precedence allows an update

Cold start produces an `observed` trait (priority 2). Later, an LLM derivation produces an `inferred` value for the same dimension (priority 1). The LLM value is ignored because 1 < 2.

But if you run `kai work start` again and get a new `observed` value for the same dimension, the update goes through because both are priority 2 (same level = allow update).

## Check trait provenance

To see why a trait has its current value:

```bash
kai profile why early_riser
```

Output includes the source and reasoning:

```
=== Why: early_riser ===
Value: 0.60
Confidence: 6/10
Source: observed
Reasoning: 35% morning commits + average message length: 52 chars

Related observations (3):
  [42] coldstart:git.commit_time_distribution (confidence: 4)
  [43] coldstart:signal.detail_level (confidence: 7)
  [44] coldstart:git.branch_pattern (confidence: 5)
```

## Troubleshooting

**Trait not updating after derive** — Check the source. If it's `declared` or `corrected`, derivation can't change it. This is working as intended.

**Correction seems permanent** — Corrections are stored in the database until manually cleared. There's no CLI command to undo a correction yet. This is a known limitation.

## Related

- [Confidence & Decay](explanation-confidence-and-decay.md) — the full explanation of confidence scales, decay, and source precedence
- [MCP Server Reference](reference-mcp-server.md) — the `derive.trigger` tool
- [How to Use Cold Start](howto-cold-start.md) — the primary source of `observed` traits
