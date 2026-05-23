# How Recommendation Feedback Works

Why Kai adjusts trait confidence when you reject task recommendations, and how this keeps your profile honest over time.

## The problem

Without feedback, recommendations are one-directional: Kai shows you tasks, you accept or ignore them, and nothing changes. If Kai recommends a "Code Review Checklist" because it thinks you're detail-oriented, but you reject it every time, the recommendation keeps appearing. The profile never learns from the mismatch.

This creates a vicious cycle: stale trait values drive irrelevant recommendations, which users ignore, which means no new signals reach the profile, which keeps traits stale.

## The approach

When you reject a recommendation, Kai reduces the confidence of the trait dimensions that drove the recommendation. This makes those dimensions weaker, which changes future recommendation rankings.

```
Recommendation shown → User rejects → Confidence -1 per relevant dimension → Future recommendations shift
```

### How it works

1. Each task template has `trait_targets` — a map of trait dimension to target value. For example, the "Code Review Checklist" template targets `detail_oriented: 0.8` and `risk_tolerance: 0.3`.

2. When a recommendation is rejected, Kai collects all trait dimensions from the rejected template's `trait_targets`.

3. For each dimension, if the current trait has confidence > 1, Kai reduces it by 1 point.

4. The floor is 1 — confidence never drops below 1.

```
Before rejection:  detail_oriented = { value: 0.8, confidence: 8 }
After rejection:    detail_oriented = { value: 0.8, confidence: 7 }
```

5. Rejected recommendations also emit a `recommendation_rejected` workspace event, recorded for audit trail.

### Accepted recommendations

Accepted recommendations emit a `recommendation_accepted` event but do not modify trait confidence. The assumption is that acceptance confirms the trait signal was correct — no adjustment needed.

### Auto-executed tasks

Tasks dispatched automatically emit `task_auto_executed` events with confidence 6 (moderate signal). These become observations through the event bus, contributing to future trait derivation.

## Trade-offs

**Confidence penalty is blunt.** Reducing confidence by 1 point per rejection doesn't distinguish between "wrong template for me" and "right idea, wrong timing." A more sophisticated system might track rejection reasons, but that requires user input most people won't provide.

**No penalty for ignoring.** If you close the terminal without selecting anything, no rejection events fire. Only explicit rejections (selecting some but not all recommendations) trigger the feedback loop. This avoids penalizing traits when the user simply didn't finish the flow.

**Single-channel feedback.** The feedback loop only operates during the CLI cold start flow. MCP tool calls to `kai_work_recommend` return recommendations but don't have a rejection mechanism. Future versions could add a `kai_recommend_feedback` tool for MCP-based rejection.

## How it connects to the event bus

```
Recommendation rejected
  → workspace event (type: recommendation_rejected, confidence: 6)
  → event bus → observation (source: workspace)
  → available for future derivation

Confidence penalty
  → direct trait update via ProfileEngine.setTrait()
  → reasoning appended: "[confidence reduced: recommendation rejected]"
```

The event bus path creates an observation record. The direct confidence penalty is a separate, immediate change to the trait. These are two independent mechanisms: the event provides a signal for future re-derivation, while the confidence penalty is an immediate adjustment.

## Alternatives considered

**Trait value adjustment instead of confidence.** Reducing the trait value (e.g., 0.8 → 0.7) would change the recommendation score directly. Rejected because value represents what the user *is*, not how confident we are. Confidence is the right knob: "maybe we're wrong about this trait" rather than "the user is less detail-oriented."

**Bayesian update.** A principled Bayesian approach would update the posterior distribution for each trait based on rejection evidence. Rejected as over-engineering for the current volume — most users complete cold start once or twice. The simple -1 penalty is proportional to the evidence strength.

**Per-template rejection tracking.** Remember which specific templates were rejected and never recommend them again. Rejected because it would hide useful recommendations if the user's context changes. The confidence penalty is softer — it shifts rankings without hard elimination.

## Related

- [How to Get Task Recommendations](howto-task-recommendations.md) — using the recommendation system
- [Event Bus](explanation-event-bus.md) — how workspace events become observations
- [Confidence & Decay](explanation-confidence-and-decay.md) — how confidence scales work
