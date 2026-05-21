# CI Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions CI workflow that runs typecheck + lint + test on every push, plus Dependabot for dependency drift prevention.

**Architecture:** Single ci.yml workflow using Bun for all steps. Pin Bun 1.3.13 for reproducibility. Minimal permissions (contents: read). Add `typecheck` and `lint` scripts to package.json. Add Dependabot config for Actions + npm. Branch protection instructions in PR body.

**Tech Stack:** GitHub Actions, Bun 1.3.13, TypeScript, Biome, @biomejs/biome

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `.github/workflows/ci.yml` | CI pipeline: checkout → setup-bun → install → typecheck → lint → test |
| Create | `.github/dependabot.yml` | Dependabot config for GitHub Actions + npm ecosystem |
| Modify | `package.json` | Add `typecheck` and `lint` scripts, add `@biomejs/biome` devDep |
| Verify | `.gitignore` | Confirm `dist/` is excluded (already confirmed ✓) |

---

### Task 1: Add typecheck and lint scripts to package.json

**Files:**
- Modify: `package.json:9-12`

- [ ] **Step 1: Add scripts and biome devDep**

In `package.json`, add `typecheck` and `lint` to scripts, and add `@biomejs/biome` to devDependencies:

```json
{
  "scripts": {
    "dev": "bun run src/cli/index.ts",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src/"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.15",
    "@types/bun": "^1.1.0",
    "knip": "^6.14.1",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Run typecheck to verify script works**

Run: `bun run typecheck`
Expected: No output (clean pass)

- [ ] **Step 3: Run lint to verify script works**

Run: `bun run lint`
Expected: "Checked 21 files in Xms. No fixes applied."

- [ ] **Step 4: Install to sync lockfile**

Run: `bun install`
Expected: Lockfile updated with @biomejs/biome entry

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "feat: add typecheck and lint scripts, add @biomejs/biome devDep"
```

---

### Task 2: Create CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create .github/workflows directory**

Run: `mkdir -p .github/workflows`

- [ ] **Step 2: Create ci.yml**

```yaml
name: CI

on:
  push:
    branches: ["*"]
  pull_request:
    branches: [master]

permissions:
  contents: read

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.13"

      - run: bun install --frozen-lockfile

      - run: bun run typecheck

      - run: bun run lint

      - run: bun test
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions CI workflow (typecheck + lint + test)"
```

---

### Task 3: Create Dependabot config

**Files:**
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Create dependabot.yml**

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly

  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    versioning-strategy: bump-if-necessary
```

Note: `bun.lock` is the lockfile used by this project. Dependabot supports bun.lock for npm ecosystem updates. The `versioning-strategy: bump-if-necessary` minimizes noise by only bumping versions when needed.

- [ ] **Step 2: Commit**

```bash
git add .github/dependabot.yml
git commit -m "ci: add Dependabot config for Actions and npm"
```

---

### Task 4: Verify end-to-end and update TODOS.md

**Files:**
- Modify: `TODOS.md`

- [ ] **Step 1: Run the full CI pipeline locally**

Run: `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun test`
Expected: All pass (typecheck clean, lint clean, 152 tests pass)

- [ ] **Step 2: Mark TODO 3 as completed in TODOS.md**

In `TODOS.md`, change the TODO 3 section header from:

```markdown
## TODO 3: CI/CD 流水线
```

to:

```markdown
### CI/CD 流水线 (TODO 3)
- **What**: 设置 GitHub Actions 自动测试 + 发布流程
- **Completed**: 2026-05-19 — ci.yml (typecheck + lint + test, Bun 1.3.13), dependabot.yml (actions + npm weekly)
```

And move it under the `## Completed` section, after the MCP Server entry.

- [ ] **Step 3: Commit**

```bash
git add TODOS.md
git commit -m "docs: mark TODO 3 CI pipeline as completed"
```

---

### Task 5: Push and create PR with branch protection instructions

**Files:**
- None (Git operations only)

- [ ] **Step 1: Push branch to remote**

Run: `git push -u origin feat/ci-cd-pipeline`

- [ ] **Step 2: Create pull request**

```bash
gh pr create --title "ci: add GitHub Actions CI pipeline and Dependabot" --body "$(cat <<'EOF'
## Summary
- Add ci.yml workflow: typecheck + lint + test on every push and PR to master
- Add dependabot.yml: weekly checks for GitHub Actions and npm dependencies
- Add `typecheck` and `lint` scripts to package.json
- Add `@biomejs/biome` as devDependency
- Pin Bun 1.3.13 in CI for reproducibility

## Branch Protection (for repo admin)
After merge, configure branch protection for `master`:
1. Settings → Branches → Add rule for `master`
2. Enable "Require status checks to pass before merging"
3. Select: `ci` job
4. Enable "Require branches to be up to date before merging"

## Test plan
- [x] `bun run typecheck` passes locally
- [x] `bun run lint` passes locally (0 errors, 21 files)
- [x] `bun test` passes locally (152 tests, 0 failures)
- [ ] CI workflow runs green on this PR
- [ ] Dependabot creates first PR within 24 hours of merge

Closes TODO 3
EOF
)"
```

- [ ] **Step 3: Verify CI runs on the PR**

Run: `gh pr checks`
Expected: All checks pass (ci job green)
