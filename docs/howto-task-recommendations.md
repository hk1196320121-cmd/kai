# How to Get Task Recommendations

Getting personalized task recommendations based on your behavioral profile, either through the CLI cold start flow or the `kai_work_recommend` MCP tool.

## Prerequisites

- Kai installed and on PATH (`bun link` from the repo)
- A profile with at least a few traits (run `kai work start` first)
- For MCP tool usage: an MCP client connected to `kai mcp serve`

## Get recommendations from CLI

After completing a cold start interview, recommendations appear automatically:

```bash
kai work start
```

If you already completed cold start, running `kai work start` again shows recommendations from your existing profile without re-interviewing:

```
Cold start already completed. Showing recommendations from existing profile...

=== Recommended Workflows ===
  1. Code Review Checklist (score: 0.89)
     Generate a code review checklist tailored to your project patterns
     Why: Matches your detail_oriented and planning_style profile — strong match
  ...
```

## Get recommendations via MCP tool

AI agents use `kai_work_recommend` to request task recommendations:

```json
{
  "tool": "kai_work_recommend",
  "arguments": {
    "domain": "coding",
    "limit": 3
  }
}
```

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| domain | `string` | No | `"general"` | Filter by domain: `coding`, `writing`, `research`, `creative`, `management`, `general` |
| limit | `number` | No | `3` | Number of recommendations (1–5) |

**Response:**

```json
{
  "recommendations": [
    {
      "templateId": "code-review-checklist",
      "title": "Code Review Checklist",
      "description": "Generate a code review checklist tailored to your project patterns",
      "score": 0.89,
      "explanation": "Matches your detail_oriented and planning_style profile — strong match",
      "matchedTraits": ["detail_oriented", "planning_style"],
      "traitTargets": { "detail_oriented": 0.8, "risk_tolerance": 0.3 }
    }
  ]
}
```

Each recommendation includes `traitTargets` — the trait dimensions that drove the match. When a user rejects a recommendation, these dimensions are penalized in the feedback loop.

## How recommendations are scored

The recommendation engine scores each of 12 task templates against your traits:

1. **Trait alignment** — For each trait target on the template, the engine compares your trait value to the target value. Closer values produce higher scores.
2. **Domain bonus** — Templates matching the requested domain get a +0.2 bonus.
3. **Score cap** — Final score is capped at 1.0.

Templates with no trait targets score 0.5 (neutral). They rank below templates with strong trait matches.

## Available templates

| Template | Domain | Trait targets |
|----------|--------|---------------|
| Daily Standup Generator | coding | detail_oriented, planning_style |
| Code Review Checklist | coding | detail_oriented, risk_tolerance |
| Bug Triage Prioritizer | coding | planning_style, risk_tolerance |
| API Design Reviewer | coding | detail_oriented, planning_style |
| Research Digest | research | detail_oriented |
| Document Outliner | writing | planning_style, preferred_output_shape |
| Sprint Planning Assistant | management | planning_style, detail_oriented |
| Design System Auditor | creative | detail_oriented |
| Personal Learning Path | general | planning_style |
| Meeting Notes Formatter | general | preferred_output_shape |
| Project Retrospective Guide | management | (none) |
| Weekly Review Generator | general | (none) |

## Approve and auto-execute (CLI only)

When recommendations appear in the CLI cold start flow, you can:

- **Type a number** (1, 2, 3) to pick one recommendation
- **Type `A`** to approve all recommendations
- **Type `N`** to skip all recommendations

Approved recommendations create ideas in the orchestrator. If an LLM API key is available, each idea is decomposed into a multi-task plan. Otherwise, a single task is created and dispatched to the Hermes agent bridge.

Rejected recommendations trigger the feedback loop, which reduces confidence for the trait dimensions that drove the match.

## Force a fresh interview

Use `--reset` to clear existing cold start data and re-run the full interview:

```bash
kai work start --reset
```

## Troubleshooting

**"No matching workflows found"** — Your profile may have too few traits. Run `kai profile derive` to derive more traits from existing observations, then try again.

**All recommendations score 0.5** — Templates score 0.5 when no trait targets match your profile. This means your traits don't align strongly with any template's target values. As your profile evolves, recommendations improve.

**MCP tool returns empty array** — The `kai_work_recommend` tool reads traits from the profile engine. If no traits exist, it returns an empty array. Run `kai work start` or `kai profile derive` first.

## Related

- [Tutorial: From Interview to Task Recommendations](tutorial-cold-start-recommendations.md) — step-by-step walkthrough of the full flow
- [How Recommendation Feedback Works](explanation-recommendation-feedback.md) — how rejected recommendations influence your profile
- [MCP Server Reference](reference-mcp-server.md) — complete API for `kai_work_recommend`
