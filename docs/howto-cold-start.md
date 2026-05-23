# How to Use Cold Start

Bootstrapping and updating your behavioral profile through the cold start flow.

## Prerequisites

- Kai installed and on PATH (`bun link` from the repo)
- A git repository with commit history (optional, improves trait quality)

## Re-run cold start

You can run `kai work start` multiple times. Each run creates a new workspace and derives fresh traits from your current answers and git history.

```bash
kai work start
```

If you already have an identity, Kai skips the name/role prompt and goes straight to the 10-question interview.

### Force a fresh interview

Use `--reset` to clear existing cold start data and re-run the full interview:

```bash
kai work start --reset
```

### Re-run without re-interview

If you run `kai work start` without `--reset` and already have interview answers, Kai skips the interview and shows task recommendations from your existing profile instead.

## Compare profiles between cold starts

After running cold start at least once, compare your current profile against the snapshot taken during that session:

```bash
kai profile diff --last
```

Output shows which traits changed, which are new, and which were removed:

```
Profile changes since cold start (2026-05-20):

  early_riser            0.6→0.8 (+0.2)   confidence 6→8 (+2)   — More morning commits this month
  + detail_oriented      new        confidence 7     — Derived from MCP observations

2 traits stable, 1 evolved, 1 new, 0 removed since cold start.
```

## Cold start with no git history

If you run `kai work start` outside a git repository (or with fewer than 5 commits), the git scan produces no signals. You still get traits from the 10 interview questions. This is fine for the first run.

```bash
# In a directory without git
kai work start
# Output: "No git history to scan (that's OK)"
```

## Edit traits during cold start

When the preview appears, type `E` to edit a specific trait:

```
> e
Which trait? (dimension name) early_riser
  Value (0.0-1.0, current: 0.6): 0.9
  Confidence (1-10, current: 6): 8

Updated preview:
...
```

Partial matches work. Typing `early` matches `early_riser`.

## Abort and restart

Press `Ctrl+C` at any point during the question flow. Kai deletes the workspace and cleans up:

```
^C
Cleaning up...
Workspace deleted. Aborted.
```

From the preview prompt, type `R` to restart without Ctrl+C:

```
> r
Restarting cold start...
```

## Troubleshooting

**"No profile found" after cold start** — The cold start requires you to confirm with `Y`. If you pressed `R` or Ctrl+C, the traits were not saved. Run `kai work start` again and confirm with `Y`.

**"No cold start snapshot found"** when running `diff --last` — You need to complete at least one `kai work start` session (answer questions, confirm with `Y`) before diff works.

**Fewer traits than expected** — The git scan requires at least 5 commits in the last 30 days. The interview-based rules use `deriveFromValues` to map answers directly to trait values. Short or vague answers may produce weaker signals.

**"Name is required. Aborting."** — The goal question is mandatory. If you skip it twice, the session aborts cleanly.

## Related

- [Cold Start Tutorial](tutorial-cold-start.md) — step-by-step walkthrough for first-time users
- [How to Use Workspaces](howto-workspace.md) — managing the workspaces created by cold start
- [Confidence & Decay](explanation-confidence-and-decay.md) — how trait values and confidence work
