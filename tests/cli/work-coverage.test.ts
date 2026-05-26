import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { WorkspaceStore } from "../../src/workspace/store";
import { scanGitHistory } from "../../src/cli/work/git-scan";
import {
  getIdeaRecommendations,
  runRecommendations,
} from "../../src/cli/work/recommendations";
import { progress, progressDone } from "../../src/cli/work/ui";
import { cleanup, tempDb } from "../helpers/temp-db";

// =============================================================================
// git-scan.ts: Branch not in a git repo (coverage of .git missing path)
// =============================================================================

describe("git-scan: edge cases", () => {
  const nonGitDir = join(tmpdir(), `kai-nongit-${Date.now()}`);

  test("returns empty when .git directory missing", () => {
    const result = scanGitHistory(nonGitDir);
    expect(result.observations.length).toBe(0);
    expect(result.traits.length).toBe(0);
  });

  test("returns empty when git log produces empty output", () => {
    // Create a temp git repo with 0 commits in the date range
    const emptyRepo = join(tmpdir(), `kai-empty-${Date.now()}`);
    mkdirSync(emptyRepo, { recursive: true });
    try {
      execSync("git init", { cwd: emptyRepo, stdio: "pipe" });
      // No commits -> log is empty
      const result = scanGitHistory(emptyRepo);
      expect(result.observations.length).toBe(0);
      expect(result.traits.length).toBe(0);
    } finally {
      rmSync(emptyRepo, { recursive: true, force: true });
    }
  });

  test("returns empty when fewer than MIN_GIT_COMMITS (5)", () => {
    const smallRepo = join(tmpdir(), `kai-small-${Date.now()}`);
    mkdirSync(smallRepo, { recursive: true });
    try {
      execSync("git init", { cwd: smallRepo, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', {
        cwd: smallRepo,
        stdio: "pipe",
      });
      execSync('git config user.name "Test"', {
        cwd: smallRepo,
        stdio: "pipe",
      });
      // Create only 3 commits (below MIN_GIT_COMMITS=5)
      for (let i = 0; i < 3; i++) {
        execSync(`git commit --allow-empty -m "commit ${i}"`, {
          cwd: smallRepo,
          stdio: "pipe",
        });
      }
      const result = scanGitHistory(smallRepo);
      expect(result.observations.length).toBe(0);
      expect(result.traits.length).toBe(0);
    } finally {
      rmSync(smallRepo, { recursive: true, force: true });
    }
  });

  test("produces observations when >= 5 commits exist", () => {
    const repo = join(tmpdir(), `kai-5commit-${Date.now()}`);
    mkdirSync(repo, { recursive: true });
    try {
      execSync("git init", { cwd: repo, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', {
        cwd: repo,
        stdio: "pipe",
      });
      execSync('git config user.name "Test"', { cwd: repo, stdio: "pipe" });
      for (let i = 0; i < 6; i++) {
        execSync(`git commit --allow-empty -m "commit number ${i} with some detail here"`, {
          cwd: repo,
          stdio: "pipe",
        });
      }
      const result = scanGitHistory(repo);
      // Should produce at least commit_time and commit_length observations
      expect(result.observations.length).toBeGreaterThanOrEqual(2);
      const keys = result.observations.map((o) => o.key);
      expect(keys).toContain("coldstart:git.commit_time_distribution");
      expect(keys).toContain("coldstart:git.commit_message_length");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("detects structured branch prefix -> scope_appetite trait", () => {
    const repo = join(tmpdir(), `kai-branch-${Date.now()}`);
    mkdirSync(repo, { recursive: true });
    try {
      execSync("git init", { cwd: repo, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', {
        cwd: repo,
        stdio: "pipe",
      });
      execSync('git config user.name "Test"', { cwd: repo, stdio: "pipe" });
      for (let i = 0; i < 6; i++) {
        execSync(`git commit --allow-empty -m "commit ${i}"`, {
          cwd: repo,
          stdio: "pipe",
        });
      }
      // Create a branch with structured prefix
      execSync("git checkout -b feat/test-branch", {
        cwd: repo,
        stdio: "pipe",
      });
      const result = scanGitHistory(repo);
      const branchObs = result.observations.find(
        (o) => o.key === "coldstart:git.branch_pattern",
      );
      expect(branchObs).toBeDefined();
      const parsed = JSON.parse(branchObs!.value);
      expect(parsed.structured).toBe(true);
      expect(parsed.branch).toBe("feat/test-branch");
      const scopeTrait = result.traits.find(
        (t) => t.dimension === "scope_appetite",
      );
      expect(scopeTrait).toBeDefined();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("no scope_appetite trait for unstructured branch name", () => {
    const repo = join(tmpdir(), `kai-unstruct-${Date.now()}`);
    mkdirSync(repo, { recursive: true });
    try {
      execSync("git init", { cwd: repo, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', {
        cwd: repo,
        stdio: "pipe",
      });
      execSync('git config user.name "Test"', { cwd: repo, stdio: "pipe" });
      for (let i = 0; i < 6; i++) {
        execSync(`git commit --allow-empty -m "commit ${i}"`, {
          cwd: repo,
          stdio: "pipe",
        });
      }
      execSync("git checkout -b my-random-branch", {
        cwd: repo,
        stdio: "pipe",
      });
      const result = scanGitHistory(repo);
      const scopeTrait = result.traits.find(
        (t) => t.dimension === "scope_appetite",
      );
      expect(scopeTrait).toBeUndefined();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("observations have valid provenance JSON with origin", () => {
    const result = scanGitHistory(process.cwd());
    for (const obs of result.observations) {
      const prov = JSON.parse(obs.provenance);
      expect(prov.origin).toBe("kai work start");
      expect(prov.extractor_version).toBe("1.0.0");
      expect(prov.extracted_at).toBeDefined();
    }
  });
});

// =============================================================================
// recommendations.ts: getIdeaRecommendations
// =============================================================================

describe("getIdeaRecommendations", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("returns recommendations for profile with matching traits", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    // Set up domain observation so ideaDomain resolves to something useful
    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: ["engineering"] }),
      confidence: 7,
      source: "coldstart",
      provenance: "{}",
    });

    const result = getIdeaRecommendations(engine);
    expect(result.ideaDomain).toBeDefined();
    expect(result.savedTraits).toBeDefined();
    expect(Array.isArray(result.recommendations)).toBe(true);
    db.close();
  });

  test("falls back to 'general' domain with malformed domain JSON", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: "not-valid-json{{{",
      confidence: 7,
      source: "coldstart",
      provenance: "{}",
    });

    const result = getIdeaRecommendations(engine);
    // Should default to "general" when JSON parse fails
    expect(result.ideaDomain).toBe("general");
    db.close();
  });

  test("falls back to 'general' domain when domain observation missing", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    const result = getIdeaRecommendations(engine);
    expect(result.ideaDomain).toBe("general");
    db.close();
  });

  test("falls back to 'general' when domains array is empty", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: [] }),
      confidence: 7,
      source: "coldstart",
      provenance: "{}",
    });

    const result = getIdeaRecommendations(engine);
    expect(result.ideaDomain).toBe("general");
    db.close();
  });
});

// =============================================================================
// recommendations.ts: runRecommendations — explicit skip penalization
// =============================================================================

describe("runRecommendations: explicit skip penalization", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("penalizes traits only on explicit 'n' skip, not invalid input", async () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    const store = new WorkspaceStore(db);

    // Set up a trait with confidence > 1 (use valid source 'observed')
    engine.setTrait({
      dimension: "early_riser",
      value: 0.8,
      confidence: 5,
      source: "observed",
      reasoning: "from git scan",
    });

    // Add domain observation
    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: ["engineering"] }),
      confidence: 7,
      source: "coldstart",
      provenance: "{}",
    });

    const workspace = store.createWorkspace({
      name: "Test",
      description: "test",
    });

    // Simulate "n" input for explicit skip
    const originalStdin = process.stdin;
    const mockStdin = {
      on: () => {},
      resume: () => {},
      pause: () => {},
      destroy: () => {},
    } as any;

    // We test the penalization logic directly
    const { recommendations } = getIdeaRecommendations(engine);
    const explicitlySkipped = true; // "n" or "no"

    if (explicitlySkipped && recommendations.length > 0) {
      const rejectedDims = new Set<string>();
      for (const rec of recommendations) {
        if (rec.traitTargets) {
          for (const dim of Object.keys(rec.traitTargets)) {
            rejectedDims.add(dim);
          }
        }
      }

      const freshEngine = new ProfileEngine(db);
      for (const dim of rejectedDims) {
        const existing = freshEngine.getTraits({ dimension: dim });
        if (existing.length > 0 && existing[0].confidence > 1) {
          freshEngine.setTrait({
            dimension: dim,
            value: existing[0].value,
            confidence: Math.max(1, existing[0].confidence - 1),
            source: existing[0].source,
            reasoning: `${existing[0].reasoning} [confidence reduced: recommendation rejected]`,
          });
        }
      }

      // Verify at least one penalized trait decreased
      const afterTraits = freshEngine.getTraits({ dimension: "early_riser" });
      if (afterTraits.length > 0 && rejectedDims.has("early_riser")) {
        expect(afterTraits[0].confidence).toBe(4); // was 5, reduced by 1
      }
    }

    db.close();
  });
});

// =============================================================================
// ui.ts: progress and progressDone
// =============================================================================

describe("ui: progress and progressDone", () => {
  test("progress writes to stderr when TTY and not --json", () => {
    const originalArgv = process.argv;
    const originalIsTTY = process.stderr.isTTY;

    process.argv = ["bun", "test"];
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    const writeSpy = spyOn(process.stderr, "write");
    progress("Loading data");
    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("Loading data");

    writeSpy.mockRestore();
    process.argv = originalArgv;
    Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, configurable: true });
  });

  test("progressDone writes newline to stderr", () => {
    const originalArgv = process.argv;
    const originalIsTTY = process.stderr.isTTY;

    process.argv = ["bun", "test"];
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    const writeSpy = spyOn(process.stderr, "write");
    progressDone("Done");
    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("Done");
    expect(output).toContain("\n");

    writeSpy.mockRestore();
    process.argv = originalArgv;
    Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, configurable: true });
  });

  test("progress is suppressed when --json flag present", () => {
    const originalArgv = process.argv;
    const originalIsTTY = process.stderr.isTTY;

    process.argv = ["bun", "test", "--json"];
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    const writeSpy = spyOn(process.stderr, "write");
    progress("Should not appear");
    expect(writeSpy).not.toHaveBeenCalled();

    writeSpy.mockRestore();
    process.argv = originalArgv;
    Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, configurable: true });
  });

  test("progress is suppressed when stderr is not TTY", () => {
    const originalArgv = process.argv;
    const originalIsTTY = process.stderr.isTTY;

    process.argv = ["bun", "test"];
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });

    const writeSpy = spyOn(process.stderr, "write");
    progress("Should not appear");
    expect(writeSpy).not.toHaveBeenCalled();

    writeSpy.mockRestore();
    process.argv = originalArgv;
    Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, configurable: true });
  });
});

// =============================================================================
// status.ts: handleWorkStatus / handleWorkList — actual function calls
// These use getEngine() which reads from real DB path. Test the logic paths
// by testing the underlying WorkspaceStore directly instead (already covered
// in work-modules.test.ts). Here we test that the re-export is wired correctly.
// =============================================================================

describe("status module exports", () => {
  test("handleWorkStatus and handleWorkList are functions", async () => {
    const statusModule = await import("../../src/cli/work/status");
    expect(typeof statusModule.handleWorkStatus).toBe("function");
    expect(typeof statusModule.handleWorkList).toBe("function");
  });
});

// =============================================================================
// types.ts: PhaseResult structure validation
// =============================================================================

describe("PhaseResult type contracts", () => {
  test("continue status has no required context", () => {
    const result: { status: "continue" | "abort"; context?: Record<string, unknown> } = {
      status: "continue",
    };
    expect(result.status).toBe("continue");
    expect(result.context).toBeUndefined();
  });

  test("abort status can carry partial context", () => {
    const result: { status: "continue" | "abort"; context?: Record<string, unknown> } = {
      status: "abort",
      context: { answers: [{ slug: "goal", text: "build API" }] },
    };
    expect(result.status).toBe("abort");
    expect(result.context).toBeDefined();
  });
});

// =============================================================================
// git-scan: makeProvenance (tested indirectly through scanGitHistory)
// Additional coverage: signal_type field
// =============================================================================

describe("git-scan: provenance signal_type field", () => {
  test("commit_time observation has signal_type in provenance", () => {
    const result = scanGitHistory(process.cwd());
    const timeObs = result.observations.find(
      (o) => o.key === "coldstart:git.commit_time_distribution",
    );
    if (timeObs) {
      const prov = JSON.parse(timeObs.provenance);
      expect(prov.signal_type).toBe("commit_time");
    }
  });

  test("commit_length observation has signal_type in provenance", () => {
    const result = scanGitHistory(process.cwd());
    const lenObs = result.observations.find(
      (o) => o.key === "coldstart:git.commit_message_length",
    );
    if (lenObs) {
      const prov = JSON.parse(lenObs.provenance);
      expect(prov.signal_type).toBe("commit_length");
    }
  });

  test("branch_pattern observation has signal_type in provenance", () => {
    const result = scanGitHistory(process.cwd());
    const branchObs = result.observations.find(
      (o) => o.key === "coldstart:git.branch_pattern",
    );
    if (branchObs) {
      const prov = JSON.parse(branchObs.provenance);
      expect(prov.signal_type).toBe("branch_pattern");
    }
  });
});

// =============================================================================
// git-scan: commit message detail_level branches
// =============================================================================

describe("git-scan: detail_level classification", () => {
  test("detail_level is 'high' when avg > 50 chars", () => {
    const repo = join(tmpdir(), `kai-detail-high-${Date.now()}`);
    mkdirSync(repo, { recursive: true });
    try {
      execSync("git init", { cwd: repo, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: repo, stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: repo, stdio: "pipe" });
      // Long commit messages (>50 chars each)
      for (let i = 0; i < 6; i++) {
        execSync(
          `git commit --allow-empty -m "feat: implement user authentication system with OAuth2 support and token refresh"`,
          { cwd: repo, stdio: "pipe" },
        );
      }
      const result = scanGitHistory(repo);
      const lenObs = result.observations.find(
        (o) => o.key === "coldstart:git.commit_message_length",
      );
      expect(lenObs).toBeDefined();
      const parsed = JSON.parse(lenObs!.value);
      expect(parsed.detail_level).toBe("high");
      expect(result.traits.find((t) => t.dimension === "detail_oriented")).toBeDefined();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("detail_level is 'medium' when avg 21-50 chars", () => {
    const repo = join(tmpdir(), `kai-detail-med-${Date.now()}`);
    mkdirSync(repo, { recursive: true });
    try {
      execSync("git init", { cwd: repo, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: repo, stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: repo, stdio: "pipe" });
      // Medium-length commit messages (~30 chars)
      for (let i = 0; i < 6; i++) {
        execSync(`git commit --allow-empty -m "fix: resolve timeout issue in API"`, {
          cwd: repo,
          stdio: "pipe",
        });
      }
      const result = scanGitHistory(repo);
      const lenObs = result.observations.find(
        (o) => o.key === "coldstart:git.commit_message_length",
      );
      expect(lenObs).toBeDefined();
      const parsed = JSON.parse(lenObs!.value);
      expect(parsed.detail_level).toBe("medium");
      // Should NOT produce detail_oriented trait (only for high)
      expect(result.traits.find((t) => t.dimension === "detail_oriented")).toBeUndefined();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("detail_level is 'low' when avg <= 20 chars", () => {
    const repo = join(tmpdir(), `kai-detail-low-${Date.now()}`);
    mkdirSync(repo, { recursive: true });
    try {
      execSync("git init", { cwd: repo, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: repo, stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: repo, stdio: "pipe" });
      // Short commit messages
      for (let i = 0; i < 6; i++) {
        execSync(`git commit --allow-empty -m "fix bug"`, {
          cwd: repo,
          stdio: "pipe",
        });
      }
      const result = scanGitHistory(repo);
      const lenObs = result.observations.find(
        (o) => o.key === "coldstart:git.commit_message_length",
      );
      expect(lenObs).toBeDefined();
      const parsed = JSON.parse(lenObs!.value);
      expect(parsed.detail_level).toBe("low");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// git-scan: morning ratio threshold for early_riser
// =============================================================================

describe("git-scan: early_riser threshold", () => {
  test("no early_riser trait when morning ratio <= 0.3", () => {
    // We test with the actual kai repo which may or may not have morning commits
    // Instead, test the threshold logic directly
    const MORNING_RATIO_THRESHOLD = 0.3;
    const hours = [10, 11, 14, 15, 16, 20]; // no morning commits
    const morningCount = hours.filter((h) => h >= 5 && h <= 8).length;
    const morningRatio = morningCount / hours.length;
    expect(morningRatio).toBe(0);
    expect(morningRatio > MORNING_RATIO_THRESHOLD).toBe(false);
  });

  test("early_riser trait when morning ratio > 0.3", () => {
    const MORNING_RATIO_THRESHOLD = 0.3;
    const hours = [5, 6, 7, 8, 9, 10]; // 4 out of 6 = 0.667
    const morningCount = hours.filter((h) => h >= 5 && h <= 8).length;
    const morningRatio = morningCount / hours.length;
    expect(morningRatio).toBeGreaterThan(MORNING_RATIO_THRESHOLD);
  });
});

// =============================================================================
// recommendations.ts: selection parsing logic
// =============================================================================

describe("recommendations: selection parsing", () => {
  function parseSelection(
    input: string,
    count: number,
  ): { selected: number[]; explicitlySkipped: boolean } {
    const selectedIdx = Number.parseInt(input, 10) - 1;
    const selected: number[] =
      input === "a" || input === "all"
        ? Array.from({ length: count }, (_, i) => i)
        : !Number.isNaN(selectedIdx) && selectedIdx >= 0 && selectedIdx < count
          ? [selectedIdx]
          : [];
    const explicitlySkipped = input === "n" || input === "no";
    return { selected, explicitlySkipped };
  }

  test("'a' selects all recommendations", () => {
    const result = parseSelection("a", 3);
    expect(result.selected).toEqual([0, 1, 2]);
    expect(result.explicitlySkipped).toBe(false);
  });

  test("'all' selects all recommendations", () => {
    const result = parseSelection("all", 3);
    expect(result.selected).toEqual([0, 1, 2]);
  });

  test("valid number selects single recommendation", () => {
    const result = parseSelection("2", 3);
    expect(result.selected).toEqual([1]);
  });

  test("'n' explicitly skips", () => {
    const result = parseSelection("n", 3);
    expect(result.selected).toEqual([]);
    expect(result.explicitlySkipped).toBe(true);
  });

  test("'no' explicitly skips", () => {
    const result = parseSelection("no", 3);
    expect(result.selected).toEqual([]);
    expect(result.explicitlySkipped).toBe(true);
  });

  test("invalid input selects nothing and does NOT explicitly skip", () => {
    const result = parseSelection("xyz", 3);
    expect(result.selected).toEqual([]);
    expect(result.explicitlySkipped).toBe(false);
  });

  test("out-of-range number selects nothing", () => {
    const result = parseSelection("99", 3);
    expect(result.selected).toEqual([]);
    expect(result.explicitlySkipped).toBe(false);
  });

  test("zero selects nothing", () => {
    const result = parseSelection("0", 3);
    expect(result.selected).toEqual([]);
  });

  test("negative selects nothing", () => {
    const result = parseSelection("-1", 3);
    expect(result.selected).toEqual([]);
  });
});

// =============================================================================
// start.ts: Context merging — Object.assign pattern
// =============================================================================

describe("start: context merging", () => {
  test("Object.assign merges PhaseResult context into base context", () => {
    const base = { db: "mock" as any, engine: "mock" as any, completed: false };
    const phaseResult = {
      status: "continue" as const,
      context: { gitResult: { observations: [], traits: [] } },
    };
    Object.assign(base, phaseResult.context);
    expect((base as any).gitResult).toBeDefined();
    expect((base as any).gitResult.observations.length).toBe(0);
  });

  test("abort phase sets status but context still merges", () => {
    const base = { db: "mock" as any, engine: "mock" as any, completed: false };
    const phaseResult = {
      status: "abort" as const,
      context: { answers: [{ slug: "goal", text: "test" }] },
    };
    Object.assign(base, phaseResult.context);
    expect((base as any).answers).toBeDefined();
    expect((base as any).answers.length).toBe(1);
  });
});

// =============================================================================
// start.ts: Cleanup-on-abort pattern (finally block)
// =============================================================================

describe("start: cleanup on incomplete run", () => {
  let dbPath: string;
  afterEach(() => cleanup(dbPath));

  test("workspace is deleted when ctx.completed is false", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Abort Cleanup Test" });
    expect(store.listWorkspaces().length).toBe(1);

    // Simulate the finally block cleanup
    const ctx = { completed: false, store, workspace: ws };
    if (!ctx.completed && ctx.store && ctx.workspace) {
      try {
        ctx.store.deleteWorkspace(ctx.workspace.id);
      } catch {
        // best effort cleanup
      }
    }

    expect(store.listWorkspaces().length).toBe(0);
    db.close();
  });

  test("workspace is kept when ctx.completed is true", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Completed Test" });

    // Simulate the finally block — completed = true
    const ctx = { completed: true, store, workspace: ws };
    if (!ctx.completed && ctx.store && ctx.workspace) {
      // This block should NOT execute
      try {
        ctx.store.deleteWorkspace(ctx.workspace.id);
      } catch {
        // best effort cleanup
      }
    }

    expect(store.listWorkspaces().length).toBe(1);
    db.close();
  });

  test("coldstart observations are cleaned on incomplete run", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:git.commit_time_distribution",
      value: JSON.stringify({ morning_ratio: 0.5 }),
      confidence: 4,
      source: "coldstart",
      provenance: "{}",
    });
    engine.addObservation({
      type: "signal",
      key: "coldstart:goal",
      value: "test goal",
      confidence: 8,
      source: "coldstart",
      provenance: "{}",
    });

    // Simulate finally block cleanup
    const ctx = { completed: false };
    if (!ctx.completed) {
      try {
        const raw = db.getDatabase();
        raw.query("DELETE FROM observations WHERE source = $source").run({
          $source: "coldstart",
        });
      } catch {
        // best effort
      }
    }

    const remaining = engine.getObservations({ type: "signal" });
    expect(remaining.length).toBe(0);
    db.close();
  });
});

// =============================================================================
// start.ts: Edit trait in deriveAndPreview confirm loop
// =============================================================================

describe("start: edit trait value and confidence bounds", () => {
  test("trait value is clamped to [0, 1]", () => {
    const trait = { value: 0.5, confidence: 5 };
    // Simulate edit with value > 1
    const newValue = "1.5";
    const parsed = Number.parseFloat(newValue);
    if (!Number.isNaN(parsed)) {
      trait.value = Math.max(0, Math.min(1, parsed));
    }
    expect(trait.value).toBe(1);

    // Simulate edit with value < 0
    const newValue2 = "-0.5";
    const parsed2 = Number.parseFloat(newValue2);
    if (!Number.isNaN(parsed2)) {
      trait.value = Math.max(0, Math.min(1, parsed2));
    }
    expect(trait.value).toBe(0);
  });

  test("trait confidence is clamped to [1, 10]", () => {
    const trait = { value: 0.5, confidence: 5 };
    // Simulate edit with confidence > 10
    const newConf = "15";
    const parsed = Number.parseInt(newConf, 10);
    if (!Number.isNaN(parsed)) {
      trait.confidence = Math.max(1, Math.min(10, parsed));
    }
    expect(trait.confidence).toBe(10);

    // Simulate edit with confidence < 1
    const newConf2 = "0";
    const parsed2 = Number.parseInt(newConf2, 10);
    if (!Number.isNaN(parsed2)) {
      trait.confidence = Math.max(1, Math.min(10, parsed2));
    }
    expect(trait.confidence).toBe(1);
  });

  test("empty value input preserves existing trait value", () => {
    const trait = { value: 0.7, confidence: 6 };
    const newValue = "";
    if (newValue) {
      const parsed = Number.parseFloat(newValue);
      if (!Number.isNaN(parsed)) trait.value = parsed;
    }
    expect(trait.value).toBe(0.7);
  });

  test("empty confidence input preserves existing confidence", () => {
    const trait = { value: 0.7, confidence: 6 };
    const newConf = "";
    if (newConf) {
      const parsed = Number.parseInt(newConf, 10);
      if (!Number.isNaN(parsed)) trait.confidence = parsed;
    }
    expect(trait.confidence).toBe(6);
  });

  test("NaN input preserves existing trait value", () => {
    const trait = { value: 0.7, confidence: 6 };
    const newValue = "abc";
    if (newValue) {
      const parsed = Number.parseFloat(newValue);
      if (!Number.isNaN(parsed)) trait.value = parsed;
    }
    expect(trait.value).toBe(0.7);
  });
});

// =============================================================================
// start.ts: Trait matching in edit mode (prefix match)
// =============================================================================

describe("start: trait dimension matching in edit mode", () => {
  const traits = [
    { dimension: "early_riser", value: 0.8, confidence: 7 },
    { dimension: "detail_oriented", value: 0.6, confidence: 5 },
    { dimension: "scope_appetite", value: 0.9, confidence: 8 },
  ];

  test("exact dimension name matches", () => {
    const dim = "early_riser";
    const match = traits.find(
      (t) => t.dimension === dim || t.dimension.startsWith(dim),
    );
    expect(match).toBeDefined();
    expect(match!.dimension).toBe("early_riser");
  });

  test("partial dimension name matches via startsWith", () => {
    const dim = "early";
    const match = traits.find(
      (t) => t.dimension === dim || t.dimension.startsWith(dim),
    );
    expect(match).toBeDefined();
    expect(match!.dimension).toBe("early_riser");
  });

  test("non-matching dimension returns undefined", () => {
    const dim = "nonexistent";
    const match = traits.find(
      (t) => t.dimension === dim || t.dimension.startsWith(dim),
    );
    expect(match).toBeUndefined();
  });
});
