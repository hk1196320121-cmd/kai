# Tutorial: Your First Cold Start

Build a behavioral profile from scratch using `kai work start`. You'll answer 10 interview questions, scan your git history, review derived traits, get task recommendations, and walk away with a working profile.

**What you'll build:** A Kai profile with derived traits from both your interview answers and your actual git commit patterns, plus personalized task recommendations.

**Time:** ~3 minutes.

## What you'll need

- [Bun](https://bun.sh) installed
- Kai cloned and dependencies installed (`bun install`)
- A git repository with at least 5 commits in the last 30 days (for git scan to work)
- Terminal access

## Step 1: Run cold start

```bash
bun run dev work start
```

If you have no existing identity, Kai asks for your name and role first:

```
First, let's set up your identity.

What's your name? Ada
What's your role? Backend engineer

Welcome, Ada!
```

## Step 2: Git history scan

Kai automatically scans the last 30 days of git commits in the current repository:

```
Scanning your git history...
  Found 3 signals from git history
```

The scan detects:
- **Commit time patterns** — are you a morning coder?
- **Commit message length** — do you write detailed commit messages?
- **Branch naming** — do you use structured prefixes like `feat/`, `fix/`?

You don't need to do anything here. The scan runs automatically.

## Step 3: Answer 10 interview questions

Kai asks 10 questions covering your planning style, schedule rhythm, output preferences, risk tolerance, autonomy level, and domain focus:

```
Workspace: abc123-def456

1/10: How do you prefer to plan your work?
  ▸ Detailed step-by-step    ▸ High-level outline    ▸ Adaptive / flexible
> Detailed step-by-step

2/10: When are you most productive?
  ▸ Early morning (5–9 AM)    ▸ Morning (9–12 PM)    ▸ Afternoon    ▸ Evening / night
> Early morning (5–9 AM)

... (8 more questions)
```

The first question (goal) is required. The rest can be left blank if you prefer. Each question maps to a specific trait dimension.

## Step 4: Review your profile draft

Kai derives traits from your answers and git history, then shows a preview:

```
✓ Profile draft generated (7 traits detected):

  detail_oriented        ████████░░  8/10  — Detailed response pattern: high (42 words avg)
  comm_style             ██████░░░░  6/10  — Communication style: moderate
  domain_context         ███████░░░  7/10  — Detected domains: engineering
  preferred_output_shape ███████░░░  7/10  — Preferred format: plan
  early_riser            ██████░░░░  6/10  — 35% morning commits + average message length: 52 chars
  scope_appetite         █████░░░░░  5/10  — Structured branch naming (feat/*)
  task_completion_rate   ████░░░░░░  4/10  — Based on workspace event patterns

Looks right? [Y]es / [E]dit trait / [R]estart
```

Each trait shows a value bar (0.0 to 1.0), confidence score (1 to 10), and the reasoning behind it.

## Step 5: Confirm or edit

Type `Y` to save the profile, or:

- **`E`** to edit a specific trait's value and confidence
- **`R`** to start over (deletes the workspace and tries again)

To edit:

```
> e
Which trait? (dimension name) detail
  Value (0.0-1.0, current: 0.8): 0.9
  Confidence (1-10, current: 8):

Updated preview:
...
```

## Step 6: Verify

```bash
bun run dev profile read
```

You should see your identity and the derived traits with values and confidence scores.

## What you built

You have a Kai profile with:
- Identity (name, role) from the setup prompt
- Traits derived from your answers (comm_style, domain, output shape, detail level)
- Traits derived from your git history (early_riser, scope_appetite, detail_oriented from commits)
- A workspace that tracks the cold start session
- A profile snapshot saved for later comparison with `kai profile diff --last`

**Next steps:**
- Track how your profile evolves: [How to Use Cold Start](howto-cold-start.md)
- Manage workspaces and tasks: [How to Use Workspaces](howto-workspace.md)
- Understand why traits have the values they do: [Confidence & Decay](explanation-confidence-and-decay.md)
