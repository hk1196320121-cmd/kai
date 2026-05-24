# CD Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up production-grade CD pipeline — build, publish, and smoke-test `kai-profile` on npm via release-please + GitHub Actions.

**Architecture:** Three sequential phases. Phase 1 updates package metadata and fixes hardcoded version strings. Phase 2 adds release-please config and the release.yml workflow. Phase 3 polishes README with badges and install instructions. Each phase is one PR.

**Tech Stack:** TypeScript (tsc), Bun runtime, npm registry, GitHub Actions, release-please, Commander.js, MCP SDK

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Package metadata: name, version, bin, files, scripts, publishConfig |
| `VERSION` | Modify | Human-readable version marker: 0.8.0.0 → 0.9.0 |
| `CHANGELOG.md` | Modify | Add 0.9.0 entry for version format migration |
| `src/cli/index.ts` | Modify | Dynamic version from package.json via readFileSync |
| `src/mcp/server.ts` | Modify | Dynamic version from package.json via readFileSync |
| `tests/mcp/server.test.ts` | Modify | Update version assertion to dynamic |
| `tests/build.test.ts` | Create | Build/publish verification tests |
| `release-please-config.json` | Create | release-please configuration |
| `.release-please-manifest.json` | Create | release-please initial version manifest |
| `.github/workflows/release.yml` | Create | Release workflow: release-please + publish + smoke-test |
| `README.md` | Modify | Install instructions + badges |

---

## Phase 1: Build Infrastructure

### Task 1: Update package.json metadata

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json with all metadata changes**

Replace the entire file:

```json
{
  "name": "kai-profile",
  "version": "0.9.0",
  "description": "AI behavioral profile engine — MCP server that builds and serves user profiles from observations",
  "type": "module",
  "bin": {
    "kai": "dist/cli/index.js"
  },
  "files": [
    "dist",
    "README.md",
    "CHANGELOG.md"
  ],
  "scripts": {
    "dev": "bun run src/cli/index.ts",
    "build": "tsc",
    "prepublishOnly": "bun run build",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src/"
  },
  "publishConfig": {
    "access": "public"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "commander": "^13.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.15",
    "@types/bun": "^1.1.0",
    "knip": "^6.14.1",
    "typescript": "^5.5.0"
  }
}
```

Key changes from eng review decisions:
- `name`: `"kai"` → `"kai-profile"` (CEO plan, confirmed available on npm)
- `version`: `"0.8.0.0"` → `"0.9.0"` (3-part semver migration)
- `description`: updated to match product identity
- `bin`: `"src/cli/index.ts"` → `"dist/cli/index.js"` (compiled output)
- `files`: explicit whitelist (no LICENSE per D7 decision — keeping Private)
- No `main`/`types` fields (D10 decision — package is CLI-only, not a library)
- Added `build`, `prepublishOnly` scripts (D5 decision)
- Added `publishConfig` for public access

- [ ] **Step 2: Verify JSON is valid**

Run: `jq . package.json > /dev/null && echo "valid"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: update package.json for npm publishing — kai-profile, 0.9.0, build script"
```

---

### Task 2: Update VERSION file and CHANGELOG

**Files:**
- Modify: `VERSION`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update VERSION to 0.9.0**

Replace the content of `VERSION`:

```
0.9.0
```

- [ ] **Step 2: Add 0.9.0 entry to CHANGELOG.md**

Insert the following at the top of `CHANGELOG.md`, after line 1 (`# Changelog`), before the existing `## [0.8.0.0]` entry:

```markdown

## [0.9.0] - 2026-05-25

### Changed
- **Version format migration**: 4-part semver (0.8.0.0) → 3-part semver (0.9.0) for release-please compatibility
- **Package name**: `kai` → `kai-profile` for npm publishing
- **Version strings**: CLI and MCP server now read version dynamically from package.json instead of hardcoded "0.1.0"
- **Build script**: Added `tsc` build step, `dist/` is the compiled output directory

### Added
- **CD release pipeline**: release-please automated versioning + npm publish workflow + smoke test
- **prepublishOnly hook**: ensures `tsc` runs before manual `npm publish`
```

- [ ] **Step 3: Verify CHANGELOG is well-formed**

Run: `head -20 CHANGELOG.md`
Expected: New 0.9.0 entry appears before the 0.8.0.0 entry.

- [ ] **Step 4: Commit**

```bash
git add VERSION CHANGELOG.md
git commit -m "chore: migrate to 3-part semver 0.9.0 and update CHANGELOG"
```

---

### Task 3: Fix CLI version string to read dynamically

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Update src/cli/index.ts to read version from package.json**

Replace lines 1-16 of `src/cli/index.ts` with:

```typescript
#!/usr/bin/env bun
import { readFileSync } from "fs";
import { Command } from "commander";
import { setNoColor } from "./format";
import { registerMcpCommands } from "./mcp";
import { registerObserveCommands } from "./observe";
import { registerProfileCommands } from "./profile";
import { registerPromptCommands } from "./prompt";
import { registerTelemetryCommands } from "./telemetry";
import { registerWorkCommands } from "./work";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
);

const program = new Command();

program
  .name("kai")
  .description("Kai — Intelligent task orchestration and personal assistant")
  .version(pkg.version)
  .option("--no-color", "Disable colored output");
```

What changed:
- Added `import { readFileSync } from "fs"` (line 2)
- Added `pkg` constant that reads `../../package.json` relative to `src/cli/index.ts` (lines 11-13)
- Changed `.version("0.1.0")` → `.version(pkg.version)` (line 20)

The path `../../package.json` resolves from `src/cli/` up two levels to the project root. After tsc compiles to `dist/cli/index.js`, the same relative path still works because `dist/` mirrors `src/` structure. npm always includes `package.json` regardless of the `files` field.

- [ ] **Step 2: Verify CLI --version works in dev mode**

Run: `bun run src/cli/index.ts --version`
Expected: `0.9.0`

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): read version dynamically from package.json"
```

---

### Task 4: Fix MCP server version string to read dynamically

**Files:**
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Update src/mcp/server.ts to read version from package.json**

Replace lines 1-19 of `src/mcp/server.ts` with:

```typescript
import { readFileSync } from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TelemetryRecorder } from "../core/telemetry/recorder";
import { TelemetryStore } from "../core/telemetry/store";
import { KaiDB } from "../db/client";
import { LLMProvider } from "../llm/provider";
import { registerHandlers } from "./handlers";
import { registerOrchestratorHandlers } from "./orchestrator-handlers";
import { registerPromptHandlers } from "./prompt-handlers";
import { registerPromptResources } from "./prompt-resources";
import { registerResources } from "./resources";
import { registerTelemetryHandlers } from "./telemetry-handlers";
import { registerTelemetryResources } from "./telemetry-resources";
import { log } from "./utils";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
);

export function createMcpServer(db: KaiDB): McpServer {
  const server = new McpServer({
    name: "kai",
    version: pkg.version,
  });
```

What changed:
- Added `import { readFileSync } from "fs"` (line 1)
- Added `pkg` constant reading `../../package.json` (lines 16-18)
- Changed `version: "0.1.0"` → `version: pkg.version` (line 23)

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Run existing MCP server tests**

Run: `bun test tests/mcp/server.test.ts`
Expected: The version test will **FAIL** with `Expected: "0.1.0" Received: "0.9.0"`. This is expected — we fix it in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(mcp): read version dynamically from package.json"
```

---

### Task 5: Update server.test.ts version assertion

**Files:**
- Modify: `tests/mcp/server.test.ts`

- [ ] **Step 1: Update the version assertion to read dynamically**

Replace lines 1-6 and lines 29-34 of `tests/mcp/server.test.ts`.

New lines 1-6:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMcpServer } from "../../src/mcp/server";
import { KaiDB } from "../../src/db/client";
import { join } from "path";
import { tmpdir } from "os";
import { readFileSync, unlinkSync } from "fs";
```

New lines 29-34 (replace the entire test block):

```typescript
  test("server has correct name and version", () => {
    const server = createMcpServer(db);
    const serverInfo = (server as any).server._serverInfo;
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
    );
    expect(serverInfo.name).toBe("kai");
    expect(serverInfo.version).toBe(pkg.version);
  });
```

This reads package.json dynamically so the test never breaks on version changes again.

- [ ] **Step 2: Run the test to verify it passes**

Run: `bun test tests/mcp/server.test.ts`
Expected: 2 tests pass. `server has correct name and version` passes with version `0.9.0`.

- [ ] **Step 3: Commit**

```bash
git add tests/mcp/server.test.ts
git commit -m "test(mcp): update server version assertion to read dynamically from package.json"
```

---

### Task 6: Add build/publish verification tests

**Files:**
- Create: `tests/build.test.ts`

- [ ] **Step 1: Write build verification tests**

Create `tests/build.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const ROOT = join(import.meta.dir, "..");

describe("build artifacts", () => {
  test("dist/cli/index.js exists with bun shebang", () => {
    const cliPath = join(ROOT, "dist", "cli", "index.js");
    expect(existsSync(cliPath)).toBe(true);
    const content = readFileSync(cliPath, "utf-8");
    expect(content.startsWith("#!/usr/bin/env bun")).toBe(true);
  });

  test("dist/mcp/server.js exists", () => {
    expect(existsSync(join(ROOT, "dist", "mcp", "server.js"))).toBe(true);
  });

  test("dist/mcp/server.d.ts declaration file exists", () => {
    expect(existsSync(join(ROOT, "dist", "mcp", "server.d.ts"))).toBe(true);
  });

  test("compiled CLI outputs correct version", () => {
    const result = spawnSync("bun", ["run", "dist/cli/index.js", "--version"], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    const version = result.stdout.trim();
    // Must be a valid semver (3-part)
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    // Must match package.json version
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf-8"),
    );
    expect(version).toBe(pkg.version);
  });

  test("dist/ preserves extensionless imports", () => {
    const serverPath = join(ROOT, "dist", "mcp", "server.js");
    const content = readFileSync(serverPath, "utf-8");
    // tsc with moduleResolution "bundler" preserves bare specifiers like "./handlers"
    expect(content).toContain('from "./handlers"');
  });
});

describe("npm pack whitelist", () => {
  test("npm pack --dry-run includes only whitelisted files", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    const files: string[] = output[0].files.map(
      (f: { path: string }) => f.path,
    );

    // Must include compiled output
    expect(files.some((f) => f.startsWith("dist/"))).toBe(true);
    // Must include metadata
    expect(files).toContain("README.md");
    expect(files).toContain("CHANGELOG.md");
    // Must include package.json (always included by npm)
    expect(files).toContain("package.json");

    // Must NOT include source files
    expect(files.some((f) => f.startsWith("src/"))).toBe(false);
    // Must NOT include tests
    expect(files.some((f) => f.includes("test"))).toBe(false);
    // Must NOT include docs
    expect(files.some((f) => f.startsWith("docs/"))).toBe(false);
    // Must NOT include CI configs
    expect(files.some((f) => f.startsWith(".github/"))).toBe(false);
  });
});
```

- [ ] **Step 2: Build first, then run tests**

Run: `bun run build && bun test tests/build.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/build.test.ts
git commit -m "test(build): add build artifact and npm pack whitelist verification"
```

---

### Task 7: Verify full build pipeline

**Files:** None (verification only)

- [ ] **Step 1: Clean build from scratch**

Run: `rm -rf dist/ && bun run build`
Expected: No errors.

- [ ] **Step 2: Verify dist/ output structure**

Run: `ls -la dist/cli/index.js dist/mcp/server.js dist/mcp/server.d.ts`
Expected: All three files exist.

- [ ] **Step 3: Verify compiled CLI works**

Run: `bun run dist/cli/index.js --version`
Expected: `0.9.0`

- [ ] **Step 4: Verify shebang preserved**

Run: `head -1 dist/cli/index.js`
Expected: `#!/usr/bin/env bun`

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass (778+ existing + new build tests).

- [ ] **Step 6: Run typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: Both pass with no errors.

---

## Phase 2: release-please Configuration

### Task 8: Create release-please config

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`

- [ ] **Step 1: Create release-please-config.json**

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "node",
      "changelog-path": "CHANGELOG.md",
      "bump-minor-pre-major": true,
      "draft": false,
      "prerelease": false
    }
  }
}
```

- [ ] **Step 2: Create .release-please-manifest.json**

```json
{
  ".": "0.9.0"
}
```

This tells release-please that the current version is `0.9.0`. The repo has one existing tag `v0.3.0.0` (4-part) which release-please ignores — it uses the manifest version to determine the next release. No tag cleanup needed.

- [ ] **Step 3: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "chore: add release-please configuration for automated versioning"
```

---

### Task 9: Create release.yml workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [master]

permissions:
  contents: write
  pull-requests: write
  id-token: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release-created: ${{ steps.release.outputs.release-created }}
      major: ${{ steps.release.outputs.major }}
      minor: ${{ steps.release.outputs.minor }}
      patch: ${{ steps.release.outputs.patch }}
      tag-name: ${{ steps.release.outputs.tag-name }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  publish:
    needs: release-please
    if: ${{ needs.release-please.outputs.release-created }}
    runs-on: ubuntu-latest
    environment: release
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version

      - run: bun install --frozen-lockfile

      - run: bun run build

      - name: Verify dist/ contents
        run: |
          test -f dist/cli/index.js || (echo "ERROR: dist/cli/index.js missing" && exit 1)
          test -f dist/mcp/server.js || (echo "ERROR: dist/mcp/server.js missing" && exit 1)
          head -1 dist/cli/index.js | grep -q '#!/usr/bin/env bun' || (echo "ERROR: shebang missing" && exit 1)

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"

      - run: npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  smoke-test:
    needs: [release-please, publish]
    if: ${{ needs.release-please.outputs.release-created }}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version

      - name: Verify published package
        run: |
          sleep 30
          VERSION="${{ needs.release-please.outputs.major }}.${{ needs.release-please.outputs.minor }}.${{ needs.release-please.outputs.patch }}"
          bunx kai-profile@${VERSION} --help
```

Key design decisions from eng review:
- `permissions` block at top level: `contents: write` + `pull-requests: write` for release-please, `id-token: write` for npm provenance (D11/Codex finding)
- `release-please` job declares `outputs:` mapping step outputs to job outputs (D2 fix)
- `publish` job uses `setup-node` for npm CLI (`npm publish --provenance` requires npm, not Bun)
- `smoke-test` verifies the published package via `bunx`
- `environment: release` gates publish behind the release environment (requires NPM_TOKEN secret)

- [ ] **Step 2: Validate YAML syntax**

Run: `node -e "JSON.stringify(require('fs').readFileSync('.github/workflows/release.yml','utf8'))" && echo "valid"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow — release-please, npm publish, smoke test"
```

---

## Phase 3: Polish

### Task 10: Update README with install instructions and badges

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add badges after the title**

Insert after line 1 (`# Kai`), as new lines 2-5:

```markdown
![CI](https://github.com/hk1196320121-cmd/kai/actions/workflows/ci.yml/badge.svg)
![npm](https://img.shields.io/npm/v/kai-profile)
```

No license badge (D7 decision — package is Private).

- [ ] **Step 2: Update Install section**

Replace the existing `## Install` section (lines 27-43) with:

```markdown
## Install

Requires [Bun](https://bun.sh) runtime.

```bash
bunx kai-profile
```

Or install globally:

```bash
bun add -g kai-profile
kai <command>
```

Or clone for development:

```bash
git clone https://github.com/hk1196320121-cmd/kai.git
cd kai
bun install
```
```

- [ ] **Step 3: Verify README renders correctly**

Run: `head -50 README.md`
Expected: Badges appear under title. Install section shows `bunx kai-profile` as primary method.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add npm badges and bunx install instructions"
```

---

### Task 11: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: Both pass.

- [ ] **Step 3: Clean build**

Run: `rm -rf dist/ && bun run build && bun run dist/cli/index.js --version`
Expected: `0.9.0`

- [ ] **Step 4: Verify all new/modified files are committed**

Run: `git status`
Expected: Clean working tree (no uncommitted changes).

- [ ] **Step 5: Review the full diff**

Run: `git log --oneline master..HEAD`
Expected: ~10 commits covering all three phases.

---

## Post-Implementation: GitHub Setup (manual)

After merging to master, the repo owner must:

1. **Create `release` environment**: Settings → Environments → New environment → "release"
2. **Add `NPM_TOKEN` secret**: In the `release` environment, add an npm automation token scoped to `kai-profile`
3. **Enable workflow permissions**: Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"

Without these, the release workflow will fail on first run.

---

## Implementation Tasks (from eng review)

These are the tracked tasks from the `/plan-eng-review` session:

| ID | Priority | Component | Title | Files |
|----|----------|-----------|-------|-------|
| T1 | P1 | release.yml | Add release-please job outputs passthrough | `.github/workflows/release.yml` |
| T2 | P1 | release.yml | Add permissions block (contents, pull-requests, id-token) | `.github/workflows/release.yml` |
| T3 | P1 | tests | Update server.test.ts version assertion to dynamic | `tests/mcp/server.test.ts` |
| T4 | P2 | tests | Add build/publish verification tests | `tests/build.test.ts` |
| T5 | P2 | package.json | Add prepublishOnly: bun run build | `package.json` |
| T6 | P3 | docs | Fix plan reference: only v0.3.0.0 tag exists | (plan docs only) |
| T7 | P2 | package.json | Remove main/types — CLI-only package | `package.json` |

All tasks are addressed in the plan above:
- T1 → Task 9 (release-please outputs passthrough)
- T2 → Task 9 (permissions block)
- T3 → Task 5 (server.test.ts dynamic assertion)
- T4 → Task 6 (build.test.ts)
- T5 → Task 1 (prepublishOnly in package.json)
- T6 → Noted in Task 8 description (tag reference corrected)
- T7 → Task 1 (no main/types in package.json)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | 5 proposals, 1 accepted, 4 deferred |
| Codex Review | `/codex review` | Independent 2nd opinion | 2 | ISSUES | Found 3 critical bugs missed by review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | CLEAR (PLAN) | Pass 1: 11 issues. Pass 2: 5 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | Not applicable (CLI/infra only) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | Not run |

**CROSS-MODEL:** Codex caught 3 critical issues the review missed: (1) release-please output names use underscores not hyphens, (2) build tests break existing CI, (3) bun.lock name mismatch after package rename. All 3 addressed via D3-D5.

**UNRESOLVED:** 0 unresolved decisions.

**VERDICT:** CEO + ENG CLEARED — ready to implement. Apply D1-D5 corrections before execution.
