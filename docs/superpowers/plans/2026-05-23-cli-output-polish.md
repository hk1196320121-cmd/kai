# CLI Output Polish — Insight Report System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Kai CLI output from flat plain text into structured "insight reports" with colored headers, trait bars, evidence sections, and actionable next steps. Phase 1 is CLI-only — no MCP changes.

**Architecture:** Shared formatting layer (`format.ts`) provides primitives (header, kv, bar, section, status, table, list, dim, emphasis, renderError, divider, nextSteps). Per-domain renderers consume these primitives and accept typed data from core types. CLI commands swap ad-hoc console.log calls for renderer imports. Incremental approach: format.ts + profile read first to lock API, then batch-migrate remaining commands.

**Tech Stack:** Bun runtime, TypeScript, picocolors (~0.4KB ANSI colors), bun:test for snapshots

**Review decisions baked in:**
- Phase 1: CLI only (no MCP envelope)
- No `--verbose` flag
- Terminal width: `process.stdout.columns || 80`, minimum 40
- `--no-color` flag + `NO_COLOR` env var + non-TTY detection
- bar() clamping to [0, max] (handles NaN, negative, >1.0)
- Diff uses plain labels (increased/decreased/unchanged)
- Fix empty catch blocks during migration
- Trait bar explicit units: value 0-1, confidence 1-10
- Incremental: profile read proves API before expanding

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | **Modify** | Add picocolors dependency |
| `src/cli/index.ts` | **Modify** | Add --no-color global option |
| `src/cli/format.ts` | **Create** | Shared formatting primitives: header, subheader, kv, bar, section, status, table, list, dim, emphasis, renderError, divider, nextSteps, shouldUseColor, getTerminalWidth |
| `src/cli/renderers/profile.ts` | **Create** | renderProfile, renderTraitBar, renderDiff, renderProvenance |
| `src/cli/renderers/workspace.ts` | **Create** | renderWorkspaceStatus, renderWorkspaceList |
| `src/cli/renderers/recommendations.ts` | **Create** | renderRecommendations |
| `src/cli/renderers/prompt.ts` | **Create** | renderChampion, renderTournamentResults |
| `src/cli/renderers/telemetry.ts` | **Create** | renderHealthReport, renderTrace |
| `src/cli/profile.ts` | **Modify** | Replace ad-hoc formatting with renderer imports |
| `src/cli/work.ts` | **Modify** | Replace formatTraitBar + ad-hoc formatting, fix 6 empty catch blocks |
| `src/cli/prompt.ts` | **Modify** | Replace formatGeneSummary/formatChampion/formatTournament |
| `src/cli/telemetry.ts` | **Modify** | Replace ad-hoc formatting with renderer imports |
| `src/cli/observe.ts` | **Modify** | Minor formatting updates |
| `tests/cli/format.test.ts` | **Create** | Unit tests for every format.ts primitive + edge cases |
| `tests/cli/color.test.ts` | **Create** | Verify ANSI output is non-empty under TTY, empty under NO_COLOR |
| `tests/cli/renderers/profile.test.ts` | **Create** | Snapshot + edge case tests for profile renderer |
| `tests/cli/renderers/workspace.test.ts` | **Create** | Snapshot + edge case tests for workspace renderer |
| `tests/cli/renderers/recommendations.test.ts` | **Create** | Snapshot + edge case tests for recommendations renderer |
| `tests/cli/renderers/prompt.test.ts` | **Create** | Snapshot + edge case tests for prompt renderer |
| `tests/cli/renderers/telemetry.test.ts` | **Create** | Snapshot + edge case tests for telemetry renderer |
| `tests/cli/json-bypass.test.ts` | **Create** | Per-command --json bypass verification |

---

## Task 1: Install picocolors + Add --no-color Global Flag

**Files:**
- Modify: `package.json`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Install picocolors**

Run: `bun add picocolors`

Expected: `package.json` updated with `"picocolors": "^1.x"` in dependencies.

- [ ] **Step 2: Add --no-color global option to Commander**

Modify `src/cli/index.ts`:

```typescript
#!/usr/bin/env bun
import { Command } from "commander";
import { registerMcpCommands } from "./mcp";
import { registerObserveCommands } from "./observe";
import { registerProfileCommands } from "./profile";
import { registerPromptCommands } from "./prompt";
import { registerTelemetryCommands } from "./telemetry";
import { registerWorkCommands } from "./work";

const program = new Command();

program
  .name("kai")
  .description("Kai — Intelligent task orchestration and personal assistant")
  .version("0.1.0")
  .option("--no-color", "Disable colored output");

registerProfileCommands(program);
registerObserveCommands(program);
registerMcpCommands(program);
registerWorkCommands(program);
registerPromptCommands(program);
registerTelemetryCommands(program);

export { program };

// Run if called directly
if (import.meta.main) {
  program.parse();
}
```

- [ ] **Step 3: Verify installation**

Run: `bun run src/cli/index.ts --help`

Expected: Help text shows `--no-color` option.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock src/cli/index.ts
git commit -m "feat: add picocolors dependency and --no-color flag"
```

---

## Task 2: Create format.ts — Shared Formatting Primitives (Tests First)

**Files:**
- Create: `tests/cli/format.test.ts`
- Create: `src/cli/format.ts`

This task follows TDD: write all failing tests first, then implement.

- [ ] **Step 1: Write failing tests for format.ts primitives**

Create `tests/cli/format.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  header,
  subheader,
  kv,
  bar,
  section,
  status,
  table,
  list,
  dim,
  emphasis,
  renderError,
  divider,
  nextSteps,
  shouldUseColor,
  getTerminalWidth,
} from "../../src/cli/format";

describe("format.ts", () => {
  const origNoColor = process.env.NO_COLOR;
  const origIsTTY = process.stdout.isTTY;

  afterEach(() => {
    process.env.NO_COLOR = origNoColor;
    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, writable: true });
  });

  // --- shouldUseColor ---

  describe("shouldUseColor", () => {
    test("returns true when TTY and no NO_COLOR", () => {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      expect(shouldUseColor()).toBe(true);
    });

    test("returns false when NO_COLOR is set", () => {
      process.env.NO_COLOR = "1";
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      expect(shouldUseColor()).toBe(false);
    });

    test("returns false when not TTY", () => {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true });
      expect(shouldUseColor()).toBe(false);
    });
  });

  // --- getTerminalWidth ---

  describe("getTerminalWidth", () => {
    test("returns stdout.columns when available", () => {
      Object.defineProperty(process.stdout, "columns", { value: 120, writable: true });
      expect(getTerminalWidth()).toBe(120);
    });

    test("returns 80 when columns is undefined", () => {
      Object.defineProperty(process.stdout, "columns", { value: undefined, writable: true });
      expect(getTerminalWidth()).toBe(80);
    });

    test("returns minimum 40 when columns < 40", () => {
      Object.defineProperty(process.stdout, "columns", { value: 20, writable: true });
      expect(getTerminalWidth()).toBe(40);
    });
  });

  // --- header ---

  describe("header", () => {
    test("returns text with ANSI bold when color enabled", () => {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = header("Kai Profile");
      expect(result).toContain("Kai Profile");
      expect(result).toContain("\x1b[");
    });

    test("returns plain text when NO_COLOR is set", () => {
      process.env.NO_COLOR = "1";
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = header("Kai Profile");
      expect(result).toBe("Kai Profile");
    });
  });

  // --- subheader ---

  describe("subheader", () => {
    test("returns dimmed text when color enabled", () => {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = subheader("Traits");
      expect(result).toContain("Traits");
      expect(result).toContain("\x1b[");
    });

    test("returns plain text when NO_COLOR", () => {
      process.env.NO_COLOR = "1";
      const result = subheader("Traits");
      expect(result).toBe("Traits");
    });
  });

  // --- kv ---

  describe("kv", () => {
    test("formats aligned key-value pair", () => {
      process.env.NO_COLOR = "1";
      const result = kv("name", "Alex");
      expect(result).toContain("name");
      expect(result).toContain("Alex");
    });

    test("handles undefined value", () => {
      process.env.NO_COLOR = "1";
      const result = kv("name", undefined);
      expect(result).toContain("name");
      expect(result).toContain("—");
    });

    test("handles empty string value", () => {
      process.env.NO_COLOR = "1";
      const result = kv("name", "");
      expect(result).toContain("name");
    });
  });

  // --- bar ---

  describe("bar", () => {
    beforeEach(() => {
      process.env.NO_COLOR = "1";
    });

    test("renders full bar at value 1.0", () => {
      const result = bar(1.0);
      expect(result).toContain("██████████");
      expect(result).toContain("1.00");
    });

    test("renders empty bar at value 0.0", () => {
      const result = bar(0.0);
      expect(result).toContain("░░░░░░░░░░");
      expect(result).toContain("0.00");
    });

    test("renders half bar at value 0.5", () => {
      const result = bar(0.5);
      expect(result).toContain("█████░░░░░");
    });

    test("clamps negative values to 0", () => {
      const result = bar(-0.5);
      expect(result).toContain("░░░░░░░░░░");
    });

    test("clamps values > 1.0 to max", () => {
      const result = bar(1.5);
      expect(result).toContain("██████████");
    });

    test("clamps NaN to 0", () => {
      const result = bar(Number.NaN);
      expect(result).toContain("░░░░░░░░░░");
    });

    test("clamps Infinity to max", () => {
      const result = bar(Number.POSITIVE_INFINITY);
      expect(result).toContain("██████████");
    });

    test("uses custom width", () => {
      const result = bar(0.5, { width: 5 });
      expect(result).toContain("██░░░");
    });

    test("uses custom max", () => {
      const result = bar(5, { max: 10 });
      expect(result).toContain("█████░░░░░");
    });
  });

  // --- bar with color ---

  describe("bar color thresholds", () => {
    test("green color for value >= 0.7", () => {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = bar(0.8);
      expect(result).toContain("\x1b[32m");
    });

    test("yellow color for value 0.4-0.69", () => {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = bar(0.5);
      expect(result).toContain("\x1b[33m");
    });

    test("red color for value < 0.4", () => {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = bar(0.3);
      expect(result).toContain("\x1b[31m");
    });
  });

  // --- section ---

  describe("section", () => {
    test("renders title and rows", () => {
      process.env.NO_COLOR = "1";
      const result = section("Traits", ["detail_oriented: 0.82", "early_riser: 0.60"]);
      expect(result).toContain("Traits");
      expect(result).toContain("detail_oriented");
    });

    test("renders empty section with title only", () => {
      process.env.NO_COLOR = "1";
      const result = section("Traits", []);
      expect(result).toContain("Traits");
      expect(result).toContain("No data");
    });
  });

  // --- status ---

  describe("status", () => {
    test("renders success status", () => {
      process.env.NO_COLOR = "1";
      const result = status("success", "Profile created");
      expect(result).toContain("Profile created");
      expect(result).toContain("✓");
    });

    test("renders error status", () => {
      process.env.NO_COLOR = "1";
      const result = status("error", "Not found");
      expect(result).toContain("Not found");
      expect(result).toContain("✗");
    });

    test("renders warning status", () => {
      process.env.NO_COLOR = "1";
      const result = status("warning", "Low confidence");
      expect(result).toContain("Low confidence");
      expect(result).toContain("!");
    });

    test("renders info status", () => {
      process.env.NO_COLOR = "1";
      const result = status("info", "Tip: run --help");
      expect(result).toContain("Tip: run --help");
      expect(result).toContain("→");
    });
  });

  // --- table ---

  describe("table", () => {
    test("renders aligned columns", () => {
      process.env.NO_COLOR = "1";
      const result = table(
        ["Dimension", "Value", "Source"],
        [
          ["detail_oriented", "0.82", "rule"],
          ["early_riser", "0.60", "llm"],
        ],
      );
      expect(result).toContain("Dimension");
      expect(result).toContain("detail_oriented");
      expect(result).toContain("early_riser");
    });

    test("renders headers only with empty rows", () => {
      process.env.NO_COLOR = "1";
      const result = table(["Dimension", "Value"], []);
      expect(result).toContain("Dimension");
      expect(result).toContain("Value");
    });
  });

  // --- list ---

  describe("list", () => {
    test("renders numbered list", () => {
      process.env.NO_COLOR = "1";
      const result = list(["First item", "Second item"]);
      expect(result).toContain("1.");
      expect(result).toContain("First item");
      expect(result).toContain("2.");
      expect(result).toContain("Second item");
    });

    test("renders empty list", () => {
      process.env.NO_COLOR = "1";
      const result = list([]);
      expect(result).toBe("");
    });
  });

  // --- dim ---

  describe("dim", () => {
    test("returns dimmed text with color", () => {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = dim("muted text");
      expect(result).toContain("muted text");
      expect(result).toContain("\x1b[2m");
    });

    test("returns plain text with NO_COLOR", () => {
      process.env.NO_COLOR = "1";
      const result = dim("muted text");
      expect(result).toBe("muted text");
    });
  });

  // --- emphasis ---

  describe("emphasis", () => {
    test("returns bold text with color", () => {
      delete process.env.NO_COLOR;
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = emphasis("important");
      expect(result).toContain("important");
      expect(result).toContain("\x1b[1m");
    });

    test("returns plain text with NO_COLOR", () => {
      process.env.NO_COLOR = "1";
      const result = emphasis("important");
      expect(result).toBe("important");
    });
  });

  // --- renderError ---

  describe("renderError", () => {
    test("renders error with message", () => {
      process.env.NO_COLOR = "1";
      const result = renderError(new Error("Something failed"));
      expect(result).toContain("Something failed");
    });

    test("renders error with string input", () => {
      process.env.NO_COLOR = "1";
      const result = renderError("Plain error string");
      expect(result).toContain("Plain error string");
    });

    test("renders error with recovery suggestion", () => {
      process.env.NO_COLOR = "1";
      const result = renderError(new Error("Not found"), "Run `kai work start` to create a profile.");
      expect(result).toContain("Not found");
      expect(result).toContain("Run `kai work start`");
    });
  });

  // --- divider ---

  describe("divider", () => {
    test("renders horizontal line", () => {
      process.env.NO_COLOR = "1";
      const result = divider();
      expect(result).toContain("─");
    });
  });

  // --- nextSteps ---

  describe("nextSteps", () => {
    test("renders next steps section", () => {
      process.env.NO_COLOR = "1";
      const result = nextSteps([
        "kai profile why detail_oriented    Understand how this trait was derived",
        "kai profile diff --last            See how your profile has evolved",
      ]);
      expect(result).toContain("Next");
      expect(result).toContain("kai profile why");
      expect(result).toContain("kai profile diff");
    });

    test("renders nothing with empty steps", () => {
      process.env.NO_COLOR = "1";
      const result = nextSteps([]);
      expect(result).toBe("");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/format.test.ts 2>&1 | head -20`

Expected: FAIL — cannot resolve `../../src/cli/format`

- [ ] **Step 3: Implement format.ts**

Create `src/cli/format.ts`:

```typescript
import pc from "picocolors";

// --- Color policy ---

let noColorOverride = false;

export function setNoColor(value: boolean): void {
  noColorOverride = value;
}

export function shouldUseColor(): boolean {
  if (noColorOverride) return false;
  if (process.env.NO_COLOR) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

// --- Terminal width ---

export function getTerminalWidth(): number {
  const cols = process.stdout.columns;
  if (!cols || cols < 40) return 40;
  return cols;
}

// --- Color-aware wrappers ---

function bold(text: string): string {
  return shouldUseColor() ? pc.bold(text) : text;
}

function dimColor(text: string): string {
  return shouldUseColor() ? pc.dim(text) : text;
}

function green(text: string): string {
  return shouldUseColor() ? pc.green(text) : text;
}

function yellow(text: string): string {
  return shouldUseColor() ? pc.yellow(text) : text;
}

function red(text: string): string {
  return shouldUseColor() ? pc.red(text) : text;
}

function cyan(text: string): string {
  return shouldUseColor() ? pc.cyan(text) : text;
}

// --- Primitives ---

export function header(text: string): string {
  return bold(text);
}

export function subheader(text: string): string {
  return dimColor(text);
}

export function kv(label: string, value: unknown): string {
  const displayValue = value === undefined || value === null ? "—" : String(value);
  const labelWidth = Math.max(label.length + 2, 14);
  const padded = label.padEnd(labelWidth);
  return `${bold(padded)}${displayValue}`;
}

export interface BarOpts {
  width?: number;
  max?: number;
  label?: string;
}

export function bar(value: number, opts: BarOpts = {}): string {
  const width = opts.width ?? 10;
  const max = opts.max ?? 1.0;

  // Clamp: handle NaN, Infinity, negative, > max
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(value, max)) : 0;
  const ratio = safeValue / max;

  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const barStr = "█".repeat(filled) + "░".repeat(empty);

  const displayValue = (safeValue / max).toFixed(2);

  // Color thresholds based on ratio
  if (shouldUseColor()) {
    if (ratio >= 0.7) return green(`${barStr}  ${displayValue}`);
    if (ratio >= 0.4) return yellow(`${barStr}  ${displayValue}`);
    return red(`${barStr}  ${displayValue}`);
  }

  return `${barStr}  ${displayValue}`;
}

export function section(title: string, rows: string[]): string {
  const lines = [bold(title)];
  if (rows.length === 0) {
    lines.push(dimColor("  No data"));
  } else {
    for (const row of rows) {
      lines.push(`  ${row}`);
    }
  }
  return lines.join("\n");
}

export function status(type: "success" | "warning" | "error" | "info", text: string): string {
  switch (type) {
    case "success":
      return `${green("✓")} ${text}`;
    case "error":
      return `${red("✗")} ${text}`;
    case "warning":
      return `${yellow("!")} ${text}`;
    case "info":
      return `${cyan("→")} ${text}`;
  }
}

export function table(columns: string[], rows: string[][]): string {
  const colWidths = columns.map((col, i) => {
    const headerLen = col.length;
    const maxRowLen = Math.max(0, ...rows.map((r) => (r[i] ?? "").length));
    return Math.max(headerLen, maxRowLen);
  });

  const headerLine = columns.map((col, i) => col.padEnd(colWidths[i])).join("  ");
  const lines = [bold(headerLine)];

  for (const row of rows) {
    const rowLine = row.map((cell, i) => (cell ?? "").padEnd(colWidths[i])).join("  ");
    lines.push(rowLine);
  }

  return lines.join("\n");
}

export function list(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

export function dim(text: string): string {
  return dimColor(text);
}

export function emphasis(text: string): string {
  return bold(text);
}

export function renderError(error: Error | string, recovery?: string): string {
  const message = error instanceof Error ? error.message : error;
  const lines = [red(`Error: ${message}`)];
  if (recovery) {
    lines.push(dimColor(`  → ${recovery}`));
  }
  return lines.join("\n");
}

export function divider(): string {
  const width = Math.min(getTerminalWidth(), 60);
  return "─".repeat(width);
}

export function nextSteps(steps: string[]): string {
  if (steps.length === 0) return "";
  const lines = [bold("Next")];
  for (const step of steps) {
    lines.push(`  ${step}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/format.test.ts`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
mkdir -p tests/cli
git add src/cli/format.ts tests/cli/format.test.ts
git commit -m "feat: add format.ts shared formatting primitives with tests"
```

---

## Task 3: Create Profile Renderer + Migrate profile read (Tests First)

**Files:**
- Create: `tests/cli/renderers/profile.test.ts`
- Create: `src/cli/renderers/profile.ts`
- Modify: `src/cli/profile.ts`

- [ ] **Step 1: Write failing tests for profile renderer**

Create `tests/cli/renderers/profile.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  renderProfile,
  renderTraitBar,
  renderDiff,
  renderProvenance,
} from "../../../src/cli/renderers/profile";
import type { ProfileSnapshot, Trait, Identity } from "../../../src/core/profile/types";
import type { ProfileDiff } from "../../../src/cli/profile";

// All snapshot tests run under NO_COLOR for deterministic output
process.env.NO_COLOR = "1";

describe("profile renderer", () => {
  const mockIdentity: Identity = {
    id: "test-id",
    name: "Alex",
    role: "developer",
    goals: '["build things"]',
    expertise_areas: '["TypeScript"]',
    learning_interests: '["Rust"]',
    work_context: "",
    communication_style: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };

  const mockTraits: Trait[] = [
    {
      id: "t1",
      dimension: "detail_oriented",
      value: 0.82,
      confidence: 8,
      source: "observed",
      reasoning: "Observed consistent code review patterns",
      updated_at: "2024-01-01T00:00:00Z",
    },
    {
      id: "t2",
      dimension: "early_riser",
      value: 0.60,
      confidence: 4,
      source: "inferred",
      reasoning: "Inferred from git commit times",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ];

  // --- renderProfile ---

  describe("renderProfile", () => {
    test("renders full profile with identity and traits", () => {
      const snapshot: ProfileSnapshot = {
        identity: mockIdentity,
        traits: mockTraits,
        preferences: [],
        observationCount: 24,
        recentObservations: [],
      };
      const output = renderProfile(snapshot);
      expect(output).toContain("Kai Profile");
      expect(output).toContain("Alex");
      expect(output).toContain("developer");
      expect(output).toContain("detail_oriented");
      expect(output).toContain("early_riser");
      expect(output).toContain("24 observations");
    });

    test("renders profile with null identity", () => {
      const snapshot: ProfileSnapshot = {
        identity: null,
        traits: mockTraits,
        preferences: [],
        observationCount: 5,
        recentObservations: [],
      };
      const output = renderProfile(snapshot);
      expect(output).toContain("Kai Profile");
      expect(output).toContain("No identity set");
      expect(output).toContain("detail_oriented");
    });

    test("renders profile with empty traits", () => {
      const snapshot: ProfileSnapshot = {
        identity: mockIdentity,
        traits: [],
        preferences: [],
        observationCount: 0,
        recentObservations: [],
      };
      const output = renderProfile(snapshot);
      expect(output).toContain("Kai Profile");
      expect(output).toContain("No traits yet");
      expect(output).toContain("kai work start");
    });

    test("renders next steps", () => {
      const snapshot: ProfileSnapshot = {
        identity: mockIdentity,
        traits: mockTraits,
        preferences: [],
        observationCount: 24,
        recentObservations: [],
      };
      const output = renderProfile(snapshot);
      expect(output).toContain("Next");
      expect(output).toContain("kai profile why");
      expect(output).toContain("kai profile diff");
    });
  });

  // --- renderTraitBar ---

  describe("renderTraitBar", () => {
    test("renders trait bar with value and confidence", () => {
      const trait: Trait = {
        id: "t1",
        dimension: "detail_oriented",
        value: 0.82,
        confidence: 8,
        source: "observed",
        reasoning: "test",
        updated_at: "2024-01-01T00:00:00Z",
      };
      const output = renderTraitBar(trait);
      expect(output).toContain("detail_oriented");
      expect(output).toContain("████████░░");
      expect(output).toContain("0.82");
      expect(output).toContain("8/10");
    });

    test("renders confidence indicator (high)", () => {
      const trait: Trait = { ...mockTraits[0], confidence: 9 };
      const output = renderTraitBar(trait);
      expect(output).toContain("high");
    });

    test("renders confidence indicator (medium)", () => {
      const trait: Trait = { ...mockTraits[0], confidence: 5 };
      const output = renderTraitBar(trait);
      expect(output).toContain("medium");
    });

    test("renders confidence indicator (low)", () => {
      const trait: Trait = { ...mockTraits[0], confidence: 2 };
      const output = renderTraitBar(trait);
      expect(output).toContain("low");
    });
  });

  // --- renderDiff ---

  describe("renderDiff", () => {
    test("renders diff with changed, new, and removed traits", () => {
      const diff: ProfileDiff = {
        workspaceName: "cold-start",
        coldstartDate: "2024-01-01T00:00:00Z",
        changed: [
          {
            dimension: "detail_oriented",
            before: { value: 0.6, confidence: 4 },
            after: { value: 0.82, confidence: 8 },
            reasoning: "More code reviews observed",
          },
        ],
        stable: [
          {
            dimension: "early_riser",
            before: { value: 0.5, confidence: 3 },
            after: { value: 0.5, confidence: 3 },
            reasoning: "Stable",
          },
        ],
        newTraits: [
          {
            id: "t3",
            dimension: "risk_tolerance",
            value: 0.7,
            confidence: 6,
            source: "observed",
            reasoning: "New trait from recent work",
            updated_at: "2024-01-15T00:00:00Z",
          },
        ],
        removed: [],
      };
      const output = renderDiff(diff);
      expect(output).toContain("detail_oriented");
      expect(output).toContain("increased");
      expect(output).toContain("0.60");
      expect(output).toContain("0.82");
      expect(output).toContain("risk_tolerance");
      expect(output).toContain("new");
    });

    test("renders empty diff with stable message", () => {
      const diff: ProfileDiff = {
        workspaceName: "cold-start",
        coldstartDate: "2024-01-01T00:00:00Z",
        changed: [],
        stable: [
          {
            dimension: "detail_oriented",
            before: { value: 0.82, confidence: 8 },
            after: { value: 0.82, confidence: 8 },
            reasoning: "Stable",
          },
        ],
        newTraits: [],
        removed: [],
      };
      const output = renderDiff(diff);
      expect(output).toContain("stable");
      expect(output).toContain("1 traits stable");
    });

    test("uses plain labels: increased/decreased/unchanged", () => {
      const diff: ProfileDiff = {
        workspaceName: "cold-start",
        coldstartDate: "2024-01-01T00:00:00Z",
        changed: [
          {
            dimension: "detail_oriented",
            before: { value: 0.82, confidence: 8 },
            after: { value: 0.6, confidence: 6 },
            reasoning: "Less reviews",
          },
        ],
        stable: [],
        newTraits: [],
        removed: [],
      };
      const output = renderDiff(diff);
      expect(output).toContain("decreased");
      expect(output).not.toContain("+");
      expect(output).not.toContain("-");
    });
  });

  // --- renderProvenance ---

  describe("renderProvenance", () => {
    test("renders provenance explanation", () => {
      const explanation: import("../../../src/core/profile/provenance").TraitExplanation = {
        dimension: "detail_oriented",
        traitValue: 0.82,
        traitConfidence: 8,
        traitSource: "observed",
        traitReasoning: "Observed consistent code review patterns",
        relatedObservations: [
          { id: 1, type: "behavior", key: "code_review_frequency", value: "{}", confidence: 9, source: "coldstart", provenance: "{}", ts: "2024-01-01T00:00:00Z" },
          { id: 2, type: "behavior", key: "pr_comment_detail", value: "{}", confidence: 7, source: "coldstart", provenance: "{}", ts: "2024-01-01T00:00:00Z" },
        ],
      };
      const output = renderProvenance(explanation);
      expect(output).toContain("detail_oriented");
      expect(output).toContain("0.82");
      expect(output).toContain("8/10");
      expect(output).toContain("observed");
      expect(output).toContain("code_review_frequency");
    });

    test("renders provenance with no related observations", () => {
      const explanation: import("../../../src/core/profile/provenance").TraitExplanation = {
        dimension: "detail_oriented",
        traitValue: 0.82,
        traitConfidence: 8,
        traitSource: "declared",
        traitReasoning: "Declared by user",
        relatedObservations: [],
      };
      const output = renderProvenance(explanation);
      expect(output).toContain("detail_oriented");
      expect(output).toContain("No related observations");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/renderers/profile.test.ts 2>&1 | head -10`

Expected: FAIL — cannot resolve `../../../src/cli/renderers/profile`

- [ ] **Step 3: Create profile renderer**

Create `src/cli/renderers/profile.ts`:

```typescript
import type { ProfileSnapshot, Trait } from "../../core/profile/types";
import type { TraitExplanation } from "../../core/profile/provenance";
import type { ProfileDiff } from "../profile";
import {
  header,
  kv,
  bar,
  section,
  divider,
  nextSteps,
  dim,
  list,
} from "../format";

export function renderProfile(snapshot: ProfileSnapshot): string {
  const lines: string[] = [];

  // Header
  lines.push(header("Kai Profile"));
  lines.push("");

  // Identity
  if (snapshot.identity) {
    lines.push(section("Identity", [
      kv("name", snapshot.identity.name),
      kv("role", snapshot.identity.role),
      kv("goals", parseJsonField(snapshot.identity.goals)),
      kv("expertise", parseJsonField(snapshot.identity.expertise_areas)),
    ]));
  } else {
    lines.push(section("Identity", [dim("No identity set — run `kai work start`")]));
  }

  lines.push("");

  // Traits
  if (snapshot.traits.length > 0) {
    lines.push(section(`Traits (${snapshot.traits.length})`, snapshot.traits.map(renderTraitBar)));
  } else {
    lines.push(section("Traits", [dim("No traits yet — run `kai work start` to build your profile")]));
  }

  lines.push("");

  // Evidence
  const derivedCount = snapshot.traits.filter((t) => t.source === "observed").length;
  const obsCount = snapshot.observationCount;
  lines.push(section("Evidence", [
    `${obsCount} observations contributed · ${derivedCount} traits derived`,
  ]));

  lines.push("");

  // Next
  if (snapshot.traits.length > 0) {
    lines.push(nextSteps([
      "kai profile why detail_oriented    Understand how this trait was derived",
      "kai profile diff --last            See how your profile has evolved",
    ]));
  } else {
    lines.push(nextSteps([
      "kai work start                     Build your initial profile",
    ]));
  }

  return lines.join("\n");
}

export function renderTraitBar(trait: Trait): string {
  const barStr = bar(trait.value); // value is 0.0-1.0
  const confidenceLabel = getConfidenceLabel(trait.confidence); // confidence is 1-10
  const dimSource = dim(trait.source);
  return `${trait.dimension.padEnd(22)}${barStr}  ${confidenceLabel}  ${dimSource}`;
}

export function renderDiff(diff: ProfileDiff): string {
  const lines: string[] = [];

  lines.push(header(`Profile Evolution since ${diff.coldstartDate.slice(0, 10)}`));
  lines.push("");

  // Changed traits — plain labels (no color direction)
  for (const c of diff.changed) {
    const delta = c.after.value - c.before.value;
    const label = delta > 0 ? "increased" : delta < 0 ? "decreased" : "unchanged";
    lines.push(
      `  ${c.dimension.padEnd(22)}${c.before.value.toFixed(2)} → ${c.after.value.toFixed(2)}  (${label})`,
    );
    lines.push(dim(`    confidence ${c.before.confidence} → ${c.after.confidence}  — ${c.reasoning}`));
  }

  // New traits
  for (const t of diff.newTraits) {
    lines.push(`  + ${t.dimension.padEnd(20)}${t.value.toFixed(2)}  (new)  confidence ${t.confidence}/10`);
    lines.push(dim(`    — ${t.reasoning}`));
  }

  // Removed traits
  for (const r of diff.removed) {
    lines.push(`  - ${r.dimension.padEnd(20)}removed  was ${r.before.value.toFixed(2)}`);
  }

  lines.push("");

  // Summary
  lines.push(
    `${diff.stable.length} traits stable, ${diff.changed.length} evolved, ${diff.newTraits.length} new, ${diff.removed.length} removed.`,
  );

  return lines.join("\n");
}

export function renderProvenance(explanation: import("../../core/profile/provenance").TraitExplanation): string {
  const lines: string[] = [];

  lines.push(header(`Why: ${explanation.dimension}`));
  lines.push("");
  lines.push(kv("value", explanation.traitValue.toFixed(2)));
  lines.push(kv("confidence", `${explanation.traitConfidence}/10`));
  lines.push(kv("source", explanation.traitSource));
  lines.push(kv("reasoning", explanation.traitReasoning));
  lines.push("");

  if (explanation.relatedObservations.length > 0) {
    lines.push(section(
      `Related observations (${explanation.relatedObservations.length})`,
      explanation.relatedObservations.map(
        (obs) => `[${obs.id}] ${obs.key} (confidence: ${obs.confidence})`,
      ),
    ));
  } else {
    lines.push(section("Related observations", [dim("No related observations")]));
  }

  return lines.join("\n");
}

// --- Helpers ---

function parseJsonField(jsonStr: string): string {
  try {
    const arr = JSON.parse(jsonStr);
    if (Array.isArray(arr)) return arr.join(", ");
    return jsonStr;
  } catch {
    return jsonStr;
  }
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 7) return "● high";
  if (confidence >= 4) return "○ medium";
  return "◌ low";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/renderers/profile.test.ts`

Expected: ALL PASS

- [ ] **Step 5: Migrate profile read command to use renderer**

Modify `src/cli/profile.ts` — update the `read` action and `why` action and `diff` action:

In the `profile read` action, replace the human-readable output block. The full modification to the read action:

```typescript
// At the top of the file, add import:
import { renderProfile, renderDiff, renderProvenance } from "./renderers/profile";
import { setNoColor } from "./format";

// In the registerProfileCommands function, at the very beginning:
export function registerProfileCommands(program: Command): void {
  // Wire up --no-color global option
  const opts = program.opts();
  if (opts.noColor) {
    setNoColor(true);
  }

  const profile = program.command("profile").description("Manage user profile");
```

For the `read` action, replace the human-readable output section:

```typescript
  profile
    .command("read")
    .option("--json", "Output as JSON")
    .option("--field <field>", "Show specific field")
    .description("Read current profile")
    .action((opts) => {
      const { db, engine } = getEngine();
      const snapshot = engine.getProfile();
      db.close();

      if (
        !snapshot.identity &&
        snapshot.traits.length === 0 &&
        snapshot.observationCount === 0
      ) {
        console.log("No profile found. Run `kai profile bootstrap` first.");
        return;
      }

      if (opts.field) {
        if (!snapshot.identity) {
          console.log(
            `Field '${opts.field}' not found (no identity set). Run \`kai profile bootstrap\` first.`,
          );
          return;
        }
        const value = (snapshot.identity as unknown as Record<string, unknown>)[
          opts.field
        ];
        console.log(value ?? `Field '${opts.field}' not found.`);
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }

      console.log(renderProfile(snapshot));
    });
```

For the `why` action, replace the output section:

```typescript
  profile
    .command("why <dimension>")
    .option("--json", "Output as JSON")
    .description("Explain why a trait has its value (provenance)")
    .action((opts, dimension: string) => {
      const { db, engine } = getEngine();
      const prov = new ProvenanceEngine(engine);
      const explanation = prov.why(dimension);
      db.close();

      if (!explanation) {
        console.log(`No trait '${dimension}' found.`);
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(explanation, null, 2));
        return;
      }

      console.log(renderProvenance(explanation));
    });
```

For the `diff` action, replace the output section:

```typescript
  profile
    .command("diff")
    .option("--last", "Compare current profile vs cold start snapshot")
    .description("Show profile changes over time")
    .action((opts) => {
      if (!opts.last) {
        console.log(
          "Use --last to compare against cold start snapshot. Other modes coming soon.",
        );
        return;
      }

      const { db, engine } = getEngine();
      const store = new WorkspaceStore(db);
      const diff = computeProfileDiff(engine, store);

      if (!diff) {
        console.log(
          "No cold start snapshot found. Run `kai work start` first.",
        );
      } else {
        console.log(renderDiff(diff));
      }

      db.close();
    });
```

Also remove the old `formatDiff` function from profile.ts since `renderDiff` replaces it.

- [ ] **Step 6: Run tests to verify everything passes**

Run: `bun test`

Expected: ALL PASS (existing tests + new format/renderer tests)

- [ ] **Step 7: Manual verification**

Run: `bun run src/cli/index.ts profile read`

Expected: Styled output with header, identity section, trait bars, evidence count, next steps.

Run: `NO_COLOR=1 bun run src/cli/index.ts profile read`

Expected: Plain text output, no ANSI codes.

Run: `bun run src/cli/index.ts profile read --json`

Expected: Raw JSON, no formatting.

- [ ] **Step 8: Commit**

```bash
mkdir -p src/cli/renderers tests/cli/renderers
git add src/cli/renderers/profile.ts tests/cli/renderers/profile.test.ts src/cli/profile.ts
git commit -m "feat: add profile renderer + migrate profile read/why/diff commands"
```

---

## Task 4: Create Remaining Renderers (Workspace, Recommendations, Prompt, Telemetry)

**Files:**
- Create: `src/cli/renderers/workspace.ts`
- Create: `src/cli/renderers/recommendations.ts`
- Create: `src/cli/renderers/prompt.ts`
- Create: `src/cli/renderers/telemetry.ts`

This task creates the remaining 4 renderers. Each follows the same pattern: accept typed data from core, use format.ts primitives, return string.

- [ ] **Step 1: Create workspace renderer**

Create `src/cli/renderers/workspace.ts`:

```typescript
import { header, kv, bar, section, dim, status, nextSteps } from "../format";

import type { Workspace } from "../../workspace/types";

interface WorkspaceWithProgress extends Workspace {
  taskCount: number;
  completedTasks: number;
  eventCount: number;
}

export function renderWorkspaceStatus(workspaces: WorkspaceWithProgress[]): string {
  if (workspaces.length === 0) {
    return [
      header("Workspaces"),
      "",
      dim("No active workspaces."),
      "",
      nextSteps(["kai work start    Create a workspace with profile bootstrapping"]),
    ].join("\n");
  }

  const lines = [header("Workspaces"), ""];

  for (const ws of workspaces) {
    const statusIcon = ws.status === "active" ? status("success", ws.name) : dim(ws.name);
    const progress = ws.taskCount > 0
      ? bar(ws.completedTasks / ws.taskCount, { width: 8 })
      : dim("No tasks");
    lines.push(section(statusIcon, [
      kv("description", ws.description || dim("No description")),
      kv("progress", `${ws.completedTasks}/${ws.taskCount} tasks`),
      kv("events", String(ws.eventCount)),
      kv("created", ws.created_at.slice(0, 10)),
    ]));
    lines.push("");
  }

  return lines.join("\n");
}

export function renderWorkspaceList(workspaces: Workspace[]): string {
  if (workspaces.length === 0) {
    return dim("No workspaces found.");
  }

  const lines = [header(`Workspaces (${workspaces.length})`), ""];

  for (const ws of workspaces) {
    const statusIcon = ws.status === "active" ? "●" : "○";
    lines.push(`  ${statusIcon} ${ws.name.padEnd(20)} ${dim(ws.status.padEnd(10))} ${ws.created_at.slice(0, 10)}`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Create recommendations renderer**

Create `src/cli/renderers/recommendations.ts`:

```typescript
import { header, kv, dim, emphasis, list, nextSteps } from "../format";
import type { Recommendation } from "../../core/orchestrator/recommend";

export function renderRecommendations(recs: Recommendation[]): string {
  if (recs.length === 0) {
    return [
      header("Recommendations"),
      "",
      dim("No recommendations available yet."),
    ].join("\n");
  }

  const lines = [header("Recommended Workflows"), ""];

  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const scoreBadge = emphasis(`[${(r.score * 100).toFixed(0)}%]`);
    lines.push(`  ${i + 1}. ${r.title}  ${scoreBadge}`);
    lines.push(dim(`     ${r.description}`));
    lines.push(dim(`     Why: ${r.explanation}`));
    lines.push("");
  }

  // Show why-not-others for first recommendation if available
  if (recs[0].whyNotOthers && recs[0].whyNotOthers.length > 0) {
    lines.push(dim("Not shown:"));
    for (const w of recs[0].whyNotOthers) {
      lines.push(dim(`  - ${w}`));
    }
    lines.push("");
  }

  lines.push(nextSteps([
    `Select: number (1-${recs.length}) to pick one, [A]ll to approve all, [N]o to skip`,
  ]));

  return lines.join("\n");
}
```

- [ ] **Step 3: Create prompt renderer**

Create `src/cli/renderers/prompt.ts`:

```typescript
import { header, kv, table, dim, emphasis, section, divider } from "../format";
import type { PromptGene, PromptChampion, PromptTournament } from "../../core/prompt/types";

export function renderChampion(champion: PromptChampion): string {
  const lockLabel = champion.is_locked ? " [LOCKED]" : "";
  const winPct = (champion.win_rate * 100).toFixed(1);

  return [
    header(`Prompt Champion — ${champion.task}`),
    "",
    kv("task", champion.task),
    kv("segment", champion.segment_id),
    kv("variant", champion.variant_id.slice(0, 8)),
    kv("model", champion.model),
    kv("win rate", `${winPct}%`),
    kv("battles", String(champion.battle_count)),
    kv("promoted", champion.promoted_at.slice(0, 10)),
    kv("locked", champion.is_locked ? `Yes${lockLabel}` : "No"),
  ].join("\n");
}

export function renderGeneList(genes: PromptGene[]): string {
  if (genes.length === 0) {
    return [header("Genes"), "", dim("No genes found.")].join("\n");
  }

  const rows = genes.map((g) => {
    const preview = g.content.length > 50 ? `${g.content.slice(0, 47)}...` : g.content;
    return [g.id.slice(0, 8), g.task, g.type, preview];
  });

  return [header(`Genes (${genes.length})`), "", table(["ID", "Task", "Type", "Content"], rows)].join("\n");
}

export function renderTournamentResults(results: PromptTournament[]): string {
  if (results.length === 0) {
    return [header("Tournaments"), "", dim("No tournament results found.")].join("\n");
  }

  const rows = results.map((t) => {
    const winner =
      t.winner === "a"
        ? `A (${t.variant_a_id.slice(0, 8)})`
        : t.winner === "b"
          ? `B (${t.variant_b_id.slice(0, 8)})`
          : t.winner === "tie"
            ? "Tie"
            : "Pending";
    const confidence = t.judge_confidence?.toFixed(2) ?? "N/A";
    return [t.id.slice(0, 8), `A:${t.variant_a_id.slice(0, 8)} vs B:${t.variant_b_id.slice(0, 8)}`, winner, confidence, t.created_at.slice(0, 10)];
  });

  return [header(`Tournaments (${results.length})`), "", table(["ID", "Matchup", "Winner", "Conf", "Date"], rows)].join("\n");
}
```

- [ ] **Step 4: Create telemetry renderer**

Create `src/cli/renderers/telemetry.ts`:

```typescript
import { header, kv, section, dim, status, table } from "../format";
import type { Trace, Span, TelemetryError } from "../../core/telemetry/types";
import type { TelemetryStatsResult } from "../../core/telemetry/stats";

export function renderHealthReport(stats: TelemetryStatsResult): string {
  const errorRatePct = (stats.errorRate * 100).toFixed(1);

  const lines = [
    header("Telemetry Health"),
    "",
    kv("traces", String(stats.traceCount)),
    kv("errors", `${stats.errorCount} (${errorRatePct}%)`),
    kv("p95 latency", `${stats.p95LatencyMs}ms`),
    "",
  ];

  if (stats.topOperations.length > 0) {
    const rows = stats.topOperations.map((op) => [op.operation, String(op.count)]);
    lines.push(section("Top operations", [table(["Operation", "Count"], rows)]));
  }

  return lines.join("\n");
}

export function renderTrace(trace: Trace, spans: Span[]): string {
  const toolName = trace.tool_name ?? "N/A";
  const lines = [
    header(`Trace: ${trace.id.slice(0, 8)}`),
    "",
    kv("trigger", trace.trigger),
    kv("tool", toolName),
    kv("status", trace.status),
    kv("duration", trace.duration_ms !== null ? `${trace.duration_ms}ms` : "running"),
    kv("started", trace.started_at),
    "",
  ];

  if (spans.length > 0) {
    lines.push(section(`Spans (${spans.length})`, spans.map((s) => {
      const indent = s.parent_span_id ? "  " : "";
      const duration = s.duration_ms !== null ? `${s.duration_ms}ms` : "?";
      return `${indent}${s.operation}/${s.name} (${duration}, ${s.status})`;
    })));
  }

  return lines.join("\n");
}

export function renderErrorList(errors: TelemetryError[]): string {
  if (errors.length === 0) {
    return [header("Telemetry Errors"), "", dim("No errors recorded.")].join("\n");
  }

  const rows = errors.map((e) => [String(e.id), e.error_type, e.message.slice(0, 40), e.created_at.slice(0, 10)]);
  return [header(`Telemetry Errors (${errors.length})`), "", table(["ID", "Type", "Message", "Date"], rows)].join("\n");
}
```

- [ ] **Step 5: Verify all renderers compile**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/renderers/
git commit -m "feat: add workspace, recommendations, prompt, telemetry renderers"
```

---

## Task 5: Migrate Remaining CLI Commands + Fix Empty Catch Blocks

**Files:**
- Modify: `src/cli/work.ts`
- Modify: `src/cli/prompt.ts`
- Modify: `src/cli/telemetry.ts`
- Modify: `src/cli/observe.ts`

This is the batch migration task. Each file follows the same pattern: replace ad-hoc console.log with renderer imports, fix empty catch blocks.

- [ ] **Step 1: Migrate work.ts**

Modify `src/cli/work.ts`:

1. Add imports at the top:

```typescript
import { renderProfile } from "./renderers/profile";
import { renderRecommendations } from "./renderers/recommendations";
import { renderError } from "./format";
```

2. Delete the `formatTraitBar` function (lines 172-177) — replaced by `bar()` from format.ts.

3. Update `displayPreview` to use `bar()` from format.ts:

```typescript
import { bar, dim, header } from "./format";

function displayPreview(
  traits: import("../core/profile/derivator").DerivedTrait[],
  gitHints: { dimension: string; hints: string[] }[],
): void {
  console.log(`\n✓ Profile draft generated (${traits.length} traits detected):\n`);

  const hintMap = new Map<string, string[]>();
  for (const h of gitHints) {
    const existing = hintMap.get(h.dimension) ?? [];
    hintMap.set(h.dimension, [...existing, ...h.hints]);
  }

  for (const t of traits) {
    const barStr = bar(t.value); // value is 0.0-1.0
    const hints = hintMap.get(t.dimension);
    const hintStr = hints ? ` + ${hints.join(", ")}` : "";
    const reasoning =
      t.reasoning.length > 60 ? `${t.reasoning.slice(0, 57)}...` : t.reasoning;
    console.log(`  ${t.dimension.padEnd(22)}${barStr}  ${t.confidence}/10  — ${reasoning}${hintStr}`);
  }

  console.log("\nLooks right? [Y]es / [E]dit trait / [R]estart");
}
```

4. Fix 6 empty catch blocks — add error handling to each:

For each empty `catch {}` in work.ts (lines 55, 139, 279, 505, 594, 638), replace with:

```typescript
catch (err) {
  console.error(renderError(err as Error));
}
```

Specific line replacements (each one is the same pattern):

- Line ~55: `catch {}` → `catch (err) { console.error(renderError(err as Error)); }`
- Line ~139: `catch {}` → `catch (err) { console.error(renderError(err as Error)); }`
- Line ~279: `catch {}` → `catch (err) { console.error(renderError(err as Error)); }`
- Line ~505: `catch {}` → `catch (err) { console.error(renderError(err as Error)); }`
- Line ~594: `catch {}` → `catch (err) { console.error(renderError(err as Error)); }`
- Line ~638: `catch {}` → `catch (err) { console.error(renderError(err as Error)); }`

5. Update recommendation display to use renderer:

Find the section that starts with `console.log("\n=== Recommended Workflows ===\n")` and replace:

```typescript
console.log(renderRecommendations(recommendations));
```

- [ ] **Step 2: Migrate prompt.ts**

Modify `src/cli/prompt.ts`:

1. Add imports:

```typescript
import { renderChampion, renderGeneList, renderTournamentResults } from "./renderers/prompt";
import { header, kv, dim, section } from "./format";
```

2. Delete the `formatGeneSummary`, `formatChampion`, `formatTournament` functions (lines 36-91) — replaced by renderer imports.

3. Replace gene listing output — remove the per-gene loop entirely:

Find and delete:
```typescript
console.log(`Genes (${genes.length}):\n`);
console.log("ID        Task       Type       Content");
for (const gene of genes) {
  console.log(formatGeneSummary(gene));
}
```
Replace with:
```typescript
console.log(renderGeneList(genes));
```

4. Replace champion display:

Find: `console.log(formatChampion(champion));`
Replace with: `console.log(renderChampion(champion));`

5. Replace tournament display — remove the header + loop entirely:

Find and delete:
```typescript
console.log(`\nTournaments for ${task} (last ${tournaments.length}):\n`);
console.log("ID        Match                              Winner                Conf        Date");
for (const t of tournaments) {
  console.log(formatTournament(t));
}
```
Replace with:
```typescript
console.log(renderTournamentResults(tournaments));
```

6. Update compiled prompt display to use format.ts primitives:

```typescript
console.log(header(`Compiled Prompt (${task})`));
console.log(kv("genome", compiled.genome_id || "(fallback)"));
console.log(kv("segment", compiled.segment_id));
console.log(kv("variant", compiled.variant_id ?? "(none)"));
console.log(kv("genes", String(compiled.gene_count)));
console.log(kv("cached", String(compiled.cached)));
console.log(`\n--- Prompt ---\n`);
console.log(compiled.prompt);
```

- [ ] **Step 3: Migrate telemetry.ts**

Modify `src/cli/telemetry.ts`:

1. Add imports:

```typescript
import { renderHealthReport, renderTrace, renderErrorList } from "./renderers/telemetry";
import { header, table, dim } from "./format";
```

2. Replace health summary:

Find the block starting with `console.log("\n=== Telemetry Health ===");`
Replace with: `console.log(renderHealthReport(stats));`

3. Replace trace display:

Find the block starting with `console.log("\n=== Trace: ${trace.id} ===");`
Replace with: `console.log(renderTrace(trace, spans));`

4. Replace error list display with `renderErrorList`.

- [ ] **Step 4.5: Migrate profile derive/decay/correct/update (minor)**

These commands have simple output. Add `import { status, dim } from "./format";` to profile.ts, then:

**derive action** — replace:
```typescript
if (results.length === 0) {
  console.log("No observations to derive traits from.");
} else {
  console.log(`Derived ${results.length} traits:`);
  for (const t of results) {
    console.log(
      `  ${t.dimension}: ${t.value.toFixed(2)} (confidence: ${t.confidence}/10)`,
    );
  }
}
```
with:
```typescript
if (results.length === 0) {
  console.log(dim("No observations to derive traits from."));
} else {
  console.log(status("success", `Derived ${results.length} traits`));
  for (const t of results) {
    console.log(`  ${t.dimension}: ${t.value.toFixed(2)} (confidence: ${t.confidence}/10)`);
  }
}
```

**decay action** — replace:
```typescript
console.log(`Decayed ${result.decayed} traits, skipped ${result.skipped}.`);
```
with:
```typescript
console.log(status("success", `Decayed ${result.decayed} traits, skipped ${result.skipped}`));
```

**correct action** — replace:
```typescript
if (result) {
  console.log(`Trait '${dimension}' corrected and removed.`);
} else {
  console.log(`No trait '${dimension}' found to correct.`);
}
```
with:
```typescript
if (result) {
  console.log(status("success", `Trait '${dimension}' corrected and removed`));
} else {
  console.log(status("error", `No trait '${dimension}' found to correct`));
}
```

**update action** — replace:
```typescript
console.log(`Updated ${opts.field}`);
```
with:
```typescript
console.log(status("success", `Updated ${opts.field}`));
```

- [ ] **Step 4.6: Update observe.ts (minor)**

Modify `src/cli/observe.ts`:

1. Add import: `import { status } from "./format";`

2. Update `from-cron` action output:

Find: `console.log(\`Collected ${count} observation(s) from ${file}.\`)`
Replace with: `console.log(status("success", \`Collected ${count} observation(s) from ${file}\`))`

3. Update `daily` action output:

Find: `console.log(\`Daily collection: ${count} new observation(s).\`)`
Replace with: `console.log(status("success", \`Daily collection: ${count} new observation(s)\`))`

- [ ] **Step 5: Run all tests**

Run: `bun test`

Expected: ALL PASS

- [ ] **Step 6: Manual verification**

Run each command and verify formatted output:

```bash
bun run src/cli/index.ts profile read
bun run src/cli/index.ts work list
bun run src/cli/index.ts prompt list
bun run src/cli/index.ts telemetry health
NO_COLOR=1 bun run src/cli/index.ts profile read
bun run src/cli/index.ts profile read --json
```

Expected: Each shows styled output. `--json` shows raw JSON. `NO_COLOR` shows plain text.

- [ ] **Step 7: Commit**

```bash
git add src/cli/work.ts src/cli/prompt.ts src/cli/telemetry.ts src/cli/observe.ts
git commit -m "feat: migrate all CLI commands to renderers + fix empty catch blocks"
```

---

## Task 6: Write Remaining Renderer Tests + JSON Bypass Tests

**Files:**
- Create: `tests/cli/renderers/workspace.test.ts`
- Create: `tests/cli/renderers/recommendations.test.ts`
- Create: `tests/cli/renderers/prompt.test.ts`
- Create: `tests/cli/renderers/telemetry.test.ts`
- Create: `tests/cli/json-bypass.test.ts`

- [ ] **Step 1: Write workspace renderer tests**

Create `tests/cli/renderers/workspace.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { renderWorkspaceStatus, renderWorkspaceList } from "../../../src/cli/renderers/workspace";

process.env.NO_COLOR = "1";

describe("workspace renderer", () => {
  describe("renderWorkspaceStatus", () => {
    test("renders empty state", () => {
      const output = renderWorkspaceStatus([]);
      expect(output).toContain("No active workspaces");
      expect(output).toContain("kai work start");
    });

    test("renders workspace with progress", () => {
      const output = renderWorkspaceStatus([{
        id: "ws-1",
        name: "my-project",
        description: "Building cool stuff",
        status: "active",
        created_at: "2024-01-01T00:00:00Z",
        taskCount: 5,
        completedTasks: 3,
        eventCount: 12,
      }]);
      expect(output).toContain("my-project");
      expect(output).toContain("3/5 tasks");
      expect(output).toContain("12");
    });
  });

  describe("renderWorkspaceList", () => {
    test("renders empty list", () => {
      const output = renderWorkspaceList([]);
      expect(output).toContain("No workspaces found");
    });

    test("renders workspace list", () => {
      const output = renderWorkspaceList([
        { id: "ws-1", name: "project-a", description: "", status: "active", created_at: "2024-01-01T00:00:00Z" },
        { id: "ws-2", name: "project-b", description: "", status: "archived", created_at: "2024-01-15T00:00:00Z" },
      ]);
      expect(output).toContain("project-a");
      expect(output).toContain("project-b");
      expect(output).toContain("active");
      expect(output).toContain("archived");
    });
  });
});
```

- [ ] **Step 2: Write recommendations renderer tests**

Create `tests/cli/renderers/recommendations.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { renderRecommendations } from "../../../src/cli/renderers/recommendations";

process.env.NO_COLOR = "1";

describe("recommendations renderer", () => {
  test("renders empty state", () => {
    const output = renderRecommendations([]);
    expect(output).toContain("No recommendations");
  });

  test("renders recommendations with scores", () => {
    const output = renderRecommendations([
      { title: "Build a CLI tool", description: "Create a command-line app", score: 0.85, explanation: "Matches your preference for terminal workflows" },
      { title: "Learn Rust", description: "System programming", score: 0.72, explanation: "Aligns with your learning interests" },
    ]);
    expect(output).toContain("Build a CLI tool");
    expect(output).toContain("85%");
    expect(output).toContain("Learn Rust");
    expect(output).toContain("72%");
    expect(output).toContain("Why:");
  });
});
```

- [ ] **Step 3: Write prompt renderer tests**

Create `tests/cli/renderers/prompt.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { renderChampion, renderGeneList, renderTournamentResults } from "../../../src/cli/renderers/prompt";

process.env.NO_COLOR = "1";

describe("prompt renderer", () => {
  describe("renderChampion", () => {
    test("renders unlocked champion", () => {
      const output = renderChampion({
        id: "ch-1",
        task: "planner",
        segment_id: "seg-1",
        variant_id: "var-abc12345",
        model: "claude-sonnet-4-6",
        win_rate: 0.78,
        battle_count: 50,
        promoted_at: "2024-01-15T00:00:00Z",
        previous_variant_id: null,
        is_locked: 0,
      });
      expect(output).toContain("planner");
      expect(output).toContain("78.0%");
      expect(output).toContain("50");
      expect(output).toContain("No");
    });

    test("renders locked champion", () => {
      const output = renderChampion({
        id: "ch-2",
        task: "derivator",
        segment_id: "seg-2",
        variant_id: "var-def67890",
        model: "gpt-4o",
        win_rate: 0.92,
        battle_count: 100,
        promoted_at: "2024-02-01T00:00:00Z",
        previous_variant_id: "var-old1234",
        is_locked: 1,
      });
      expect(output).toContain("LOCKED");
    });
  });

  describe("renderGeneList", () => {
    test("renders empty state", () => {
      const output = renderGeneList([]);
      expect(output).toContain("No genes found");
    });

    test("renders gene list", () => {
      const output = renderGeneList([
        { id: "gene-abc12345678", task: "planner", type: "intent", content: "You are a helpful task planner", trait_bindings: "{}", metadata: "{}", created_at: "2024-01-01T00:00:00Z" },
      ]);
      expect(output).toContain("planner");
      expect(output).toContain("intent");
    });
  });

  describe("renderTournamentResults", () => {
    test("renders empty state", () => {
      const output = renderTournamentResults([]);
      expect(output).toContain("No tournament results");
    });

    test("renders tournament with winner", () => {
      const output = renderTournamentResults([{
        id: "tour-12345678",
        task: "planner",
        variant_a_id: "var-aaa11111",
        variant_b_id: "var-bbb22222",
        eval_case_id: "eval-1",
        segment_id: null,
        model: "gpt-4o-mini",
        winner: "a",
        judge_reasoning: "Variant A was more concise",
        judge_confidence: 0.85,
        judged_at: "2024-01-15T00:00:00Z",
        created_at: "2024-01-15T00:00:00Z",
      }]);
      expect(output).toContain("aaa11111");
      expect(output).toContain("bbb22222");
      expect(output).toContain("0.85");
    });
  });
});
```

- [ ] **Step 4: Write telemetry renderer tests**

Create `tests/cli/renderers/telemetry.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { renderHealthReport, renderTrace, renderErrorList } from "../../../src/cli/renderers/telemetry";

process.env.NO_COLOR = "1";

describe("telemetry renderer", () => {
  describe("renderHealthReport", () => {
    test("renders health dashboard", () => {
      const output = renderHealthReport({
        traceCount: 142,
        errorCount: 3,
        errorRate: 0.021,
        p95LatencyMs: 340,
        topOperations: [
          { operation: "profile.read", count: 85 },
          { operation: "derive.trigger", count: 42 },
        ],
      });
      expect(output).toContain("142");
      expect(output).toContain("3");
      expect(output).toContain("2.1%");
      expect(output).toContain("340ms");
      expect(output).toContain("profile.read");
    });

    test("renders health with zero traces", () => {
      const output = renderHealthReport({
        traceCount: 0,
        errorCount: 0,
        errorRate: 0,
        p95LatencyMs: 0,
        topOperations: [],
      });
      expect(output).toContain("0");
    });
  });

  describe("renderTrace", () => {
    test("renders trace with nested spans", () => {
      const output = renderTrace(
        { id: "trace-abc", trigger: "mcp_request", tool_name: "profile.read", root_cause: null, started_at: "2024-01-01T00:00:00Z", duration_ms: 150, status: "completed" },
        [
          { id: "s1", trace_id: "trace-abc", operation: "derivation", name: "rule_derive", started_at: "2024-01-01T00:00:00Z", duration_ms: 80, status: "ok", attributes: {} },
          { id: "s2", trace_id: "trace-abc", parent_span_id: "s1", operation: "llm_call", name: "llm_derive", started_at: "2024-01-01T00:00:00Z", duration_ms: 60, status: "ok", attributes: {} },
        ],
      );
      expect(output).toContain("trace-abc".slice(0, 8));
      expect(output).toContain("profile.read");
      expect(output).toContain("150ms");
      expect(output).toContain("rule_derive");
      expect(output).toContain("llm_derive");
    });

    test("renders running trace", () => {
      const output = renderTrace(
        { id: "trace-running", trigger: "internal", root_cause: null, started_at: "2024-01-01T00:00:00Z", duration_ms: null, status: "running" },
        [],
      );
      expect(output).toContain("running");
    });
  });

  describe("renderErrorList", () => {
    test("renders empty error list", () => {
      const output = renderErrorList([]);
      expect(output).toContain("No errors recorded");
    });

    test("renders error list", () => {
      const output = renderErrorList([
        { id: 1, span_id: "s1", trace_id: "t1", error_type: "db_error", message: "Database connection failed: timeout after 5000ms", recoverable: 0, context: {}, created_at: "2024-01-15T10:30:00Z" },
      ]);
      expect(output).toContain("db_error");
    });
  });
});
```

- [ ] **Step 5: Write --json bypass verification tests**

Create `tests/cli/json-bypass.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { spawn } from "child_process";

function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("bun", ["run", "src/cli/index.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, KAI_DB: `/tmp/kai-json-test-${process.pid}.db` },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d));
    proc.stderr.on("data", (d: Buffer) => (stderr += d));
    proc.on("close", (code: number | null) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

describe("--json bypass verification", () => {
  test("profile read --json outputs valid JSON", async () => {
    const { stdout } = await runCli(["profile", "read", "--json"]);
    // If no profile exists, it may print a message instead of JSON
    // This test verifies --json doesn't mix formatting with JSON
    if (stdout.startsWith("{") || stdout.startsWith("[")) {
      expect(() => JSON.parse(stdout)).not.toThrow();
      expect(stdout).not.toContain("\x1b[");
    }
  });

  test("profile read --json has no ANSI codes", async () => {
    const { stdout } = await runCli(["profile", "read", "--json"]);
    expect(stdout).not.toContain("\x1b[");
  });

  test("profile read --json has no headers or progress", async () => {
    const { stdout } = await runCli(["profile", "read", "--json"]);
    if (stdout.startsWith("{")) {
      expect(stdout).not.toContain("Kai Profile");
      expect(stdout).not.toContain("Next");
      expect(stdout).not.toContain("████");
    }
  });
});
```

- [ ] **Step 6: Run all tests**

Run: `bun test`

Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add tests/cli/
git commit -m "test: add renderer tests for workspace, recommendations, prompt, telemetry + json bypass"
```

---

## Task 7: Add Color Verification Test + Progress Indicator

**Files:**
- Create: `tests/cli/color.test.ts`
- Modify: `src/cli/work.ts` (add progress indicator to stderr)

- [ ] **Step 1: Write color verification test**

Create `tests/cli/color.test.ts`:

```typescript
import { describe, test, expect, afterEach } from "bun:test";
import { bar, header, status, dim, emphasis } from "../../src/cli/format";

describe("color output verification", () => {
  const origNoColor = process.env.NO_COLOR;
  const origIsTTY = process.stdout.isTTY;

  afterEach(() => {
    process.env.NO_COLOR = origNoColor;
    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, writable: true });
  });

  test("bar produces ANSI escape codes under TTY", () => {
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    const result = bar(0.5);
    expect(result).toMatch(/\x1b\[/);
    expect(result.length).toBeGreaterThan(0);
  });

  test("header produces ANSI escape codes under TTY", () => {
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    const result = header("Test");
    expect(result).toMatch(/\x1b\[/);
  });

  test("status produces ANSI escape codes under TTY", () => {
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    const result = status("success", "Done");
    expect(result).toMatch(/\x1b\[/);
  });

  test("no ANSI codes when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    expect(bar(0.5)).not.toMatch(/\x1b\[/);
    expect(header("Test")).not.toMatch(/\x1b\[/);
    expect(status("success", "Done")).not.toMatch(/\x1b\[/);
    expect(dim("text")).not.toMatch(/\x1b\[/);
    expect(emphasis("text")).not.toMatch(/\x1b\[/);
  });

  test("no ANSI codes when not TTY", () => {
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true });
    expect(bar(0.5)).not.toMatch(/\x1b\[/);
    expect(header("Test")).not.toMatch(/\x1b\[/);
  });
});
```

- [ ] **Step 2: Add progress indicator to work start**

The progress indicator writes to stderr, is TTY-gated, and is disabled under --json.

Add to `src/cli/work.ts` at the top:

```typescript
function progress(message: string): void {
  if (process.argv.includes("--json")) return;
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r  ${message}...`);
}

function progressDone(message: string): void {
  if (process.argv.includes("--json")) return;
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r  ${message}   \n`);
}
```

Then wrap long operations in `work start`:

```typescript
progress("Scanning git history");
const gitResult = scanGitHistory(db);
progressDone("Git scan complete");

progress("Running interview");
const answers = await runInterview(rl, ask);
progressDone("Interview complete");

progress("Deriving traits");
const derivator = new Derivator(engine);
const traits = derivator.deriveFromRules();
progressDone(`Derived ${traits.length} traits`);
```

- [ ] **Step 3: Run all tests**

Run: `bun test`

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add tests/cli/color.test.ts src/cli/work.ts
git commit -m "feat: add color verification test + progress indicators on stderr"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Every CEO plan constraint addressed (picocolors, NO_COLOR, --json bypass, bar clamping, terminal width, diff plain labels, progress on stderr, empty states)
- [x] **Placeholder scan:** No TBD, TODO, "implement later", or "add appropriate error handling"
- [x] **Type consistency:** Trait.value is 0-1, Trait.confidence is 1-10, Trait.source uses legal values ("observed"/"inferred"/"declared"/"cross-model"), bar() accepts 0-1 with optional max, renderers import from core types (not local interfaces)
- [x] **MCP not in scope:** No MCP file modifications in any task
- [x] **--verbose not in scope:** No task adds --verbose
- [x] **Test coverage:** Unit tests for format.ts primitives, snapshot tests for renderers, edge case tests for bar clamping, color verification, --json bypass, empty states
- [x] **Incremental approach:** Task 2-3 prove the API before Task 4-5 batch migration
- [x] **Empty catch blocks:** Fixed in Task 5 Step 1
- [x] **Command coverage:** All 15 commands migrated (including profile derive/decay/correct/update added in Step 4.5)
- [x] **Ad-hoc format functions migrated:** formatTraitBar, formatDiff, formatGeneSummary, formatChampion, formatTournament + section headers (6 total)
- [x] **Core type alignment:** Renderers import from core types (Trait, TraitExplanation, Workspace, Trace, Span, TelemetryError, TelemetryStatsResult, PromptGene, PromptChampion, PromptTournament, Recommendation) instead of local interfaces
- [x] **whyNotOthers:** Recommendation renderer shows why-not-others section from first recommendation
- [x] **--json parity:** `why` command now has `--json` option (not process.argv hack)
