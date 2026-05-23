# Tutorial: From Interview to Task Recommendations

Build a profile through the 10-question interview, get personalized task recommendations, and auto-execute them. You'll walk away with a working profile and dispatched tasks.

**What you'll build:** A Kai profile derived from 10 interview answers plus git history, with task templates matched to your behavioral traits and dispatched for execution.

**Time:** ~5 minutes.

## What you'll need

- [Bun](https://bun.sh) installed
- Kai cloned and dependencies installed (`bun install`)
- A git repository with at least 5 commits in the last 30 days (improves trait quality)
- Terminal access

## Step 1: Run cold start

```bash
bun run dev work start
```

If you have no existing identity, Kai asks for your name and role:

```
First, let's set up your identity.

What's your name? Ada
What's your role? Backend engineer

Welcome, Ada!
```

## Step 2: Git history scan

Kai scans the last 30 days of git commits automatically:

```
Scanning your git history...
  Found 3 signals from git history
```

The scan detects commit time patterns, message thoroughness, and branch naming conventions. You don't need to do anything here.

## Step 3: Answer 10 interview questions

Kai walks you through 10 questions covering your work habits and preferences:

```
Workspace: abc123-def456

1. What are you trying to get done?
> Building a REST API for user profiles

2. What would a good result look like?
> Endpoints for CRUD, proper validation, and tests covering edge cases

3. Any constraints — people, tools, deadlines?
> Must ship by Friday, using PostgreSQL, team of 2

4. What kind of work do you mostly do?
  ▸ engineering    ▸ design    ▸ management    ▸ research    ▸ writing    ▸ other
> engineering

5. How do you approach a new project?
  ▸ detailed plan    ▸ rough outline    ▸ explore first    ▸ dive right in
> detailed plan

6. When are you most productive?
  ▸ morning    ▸ afternoon    ▸ evening    ▸ late night    ▸ flexible
> morning

7. How should Kai organize your work?
  ▸ checklist    ▸ brief    ▸ plan    ▸ decision log
> checklist

8. How do you feel about trying unproven approaches?
  ▸ only when confident    ▸ after basic testing    ▸ when it compiles
> after basic testing

9. How much should Kai act on its own?
  ▸ ask every time    ▸ suggest only    ▸ act autonomously
> suggest only

10. What AI behavior would annoy you most?
  ▸ acts without asking    ▸ too verbose    ▸ too cautious    ▸ asks too many questions    ▸ ignores context
> acts without asking
```

Question 1 (goal) is required. The rest are optional — press Enter to skip any of them. Each question with a `traitTarget` maps your answer directly to a specific behavioral trait dimension.

## Step 4: Review your profile

Kai derives traits from your answers and git history, then shows a preview:

```
✓ Profile draft generated (12 traits detected):

  detail_oriented        ████████░░  8/10  — Detailed response pattern: high (42 words avg)
  planning_style         ███████░░░  7/10  — Mapped from "detailed plan" answer
  schedule_rhythm        ██████░░░░  6/10  — Mapped from "morning" answer
  preferred_output_shape ███████░░░  7/10  — Mapped from "checklist" answer
  domain_context         ███████░░░  7/10  — Detected domains: engineering
  ...

Looks right? [Y]es / [E]dit trait / [R]estart
```

Type `Y` to save, `E` to edit a specific trait, or `R` to start over.

## Step 5: Get task recommendations

After confirming your profile, Kai matches task templates against your traits:

```
=== Recommended Workflows ===

  1. Code Review Checklist (score: 0.89)
     Generate a code review checklist tailored to your project patterns
     Why: Matches your detail_oriented and planning_style profile — strong match

  2. Daily Standup Generator (score: 0.82)
     Generate a daily standup report from git activity and task status
     Why: Matches your detail_oriented profile — strong match

  3. Bug Triage Prioritizer (score: 0.71)
     Prioritize bugs by impact and urgency using project context
     Why: Matches your planning_style profile — good fit for your work style

  Not shown:
    - Document Outliner (score: 0.55) — generic template, ranked lower

Select: number (1-3) to pick one, [A]ll to approve all, [N]o to skip
```

Type `A` to approve all, a number to pick one, or `N` to skip.

## Step 6: Auto-execute

Approved recommendations become ideas in the orchestrator. If an LLM API key is configured, Kai decomposes each idea into a task plan. Otherwise, it creates a single task and dispatches it:

```
Plan generated (3 tasks):
  - Write API endpoint for GET /profiles/:id
  - Add validation middleware for POST /profiles
  - Write integration tests for CRUD endpoints
✓ Task dispatched: Write API endpoint for GET /profiles/:id
```

If no LLM key is available:

```
✓ Task dispatched: Code Review Checklist
```

Tasks are dispatched to the Hermes agent bridge for execution.

## Step 7: Re-run without re-interview

Run `kai work start` again to see recommendations from your existing profile:

```bash
bun run dev work start
```

```
Cold start already completed. Showing recommendations from existing profile...

=== Recommended Workflows ===
  1. Code Review Checklist (score: 0.89)
  ...
```

To force a fresh interview, use `--reset`:

```bash
bun run dev work start --reset
```

## What you built

You have:
- A Kai profile with 10+ traits from interview answers and git history
- Personalized task recommendations scored by trait alignment
- Auto-executed tasks dispatched to the Hermes agent bridge
- A workspace tracking the cold start session

**Next steps:**
- Track recommendations via MCP: [How to Get Task Recommendations](howto-task-recommendations.md)
- Understand the feedback loop: [How Recommendation Feedback Works](explanation-recommendation-feedback.md)
- Manage workspaces: [How to Use Workspaces](howto-workspace.md)
