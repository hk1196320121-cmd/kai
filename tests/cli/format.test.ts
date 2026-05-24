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
  setNoColor,
} from "../../src/cli/format";

describe("format.ts", () => {
  const origNoColor = process.env.NO_COLOR;
  const origIsTTY = process.stdout.isTTY;

  afterEach(() => {
    // Reset noColor override between tests
    setNoColor(false);
    if (origNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = origNoColor;
    }
    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, writable: true });
  });

  // --- shouldUseColor ---

  describe("shouldUseColor", () => {
    test("returns true when TTY and no NO_COLOR", () => {
      delete process.env.NO_COLOR;
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      expect(shouldUseColor()).toBe(true);
    });

    test("returns false when NO_COLOR is set", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      expect(shouldUseColor()).toBe(false);
    });

    test("returns false when not TTY", () => {
      delete process.env.NO_COLOR;
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true });
      expect(shouldUseColor()).toBe(false);
    });

    test("returns false when noColorOverride is set", () => {
      delete process.env.NO_COLOR;
      setNoColor(true);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
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
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = header("Kai Profile");
      expect(result).toContain("Kai Profile");
      expect(result).toContain("\x1b[");
    });

    test("returns plain text when NO_COLOR is set", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = header("Kai Profile");
      expect(result).toBe("Kai Profile");
    });
  });

  // --- subheader ---

  describe("subheader", () => {
    test("returns dimmed text when color enabled", () => {
      delete process.env.NO_COLOR;
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = subheader("Traits");
      expect(result).toContain("Traits");
      expect(result).toContain("\x1b[");
    });

    test("returns plain text when NO_COLOR", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = subheader("Traits");
      expect(result).toBe("Traits");
    });
  });

  // --- kv ---

  describe("kv", () => {
    test("formats aligned key-value pair", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = kv("name", "Alex");
      expect(result).toContain("name");
      expect(result).toContain("Alex");
    });

    test("handles undefined value", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = kv("name", undefined);
      expect(result).toContain("name");
      expect(result).toContain("—"); // em dash
    });

    test("handles empty string value", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = kv("name", "");
      expect(result).toContain("name");
    });

    test("pads label to at least 14 characters", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = kv("x", "val");
      // Label "x" (1 char) should be padded to at least 14 chars
      expect(result.startsWith("x")).toBe(true);
      expect(result.indexOf("val")).toBeGreaterThanOrEqual(13);
    });
  });

  // --- bar ---

  describe("bar", () => {
    beforeEach(() => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
    });

    test("renders full bar at value 1.0", () => {
      const result = bar(1.0);
      expect(result).toContain("██████████"); // 10 full blocks
      expect(result).toContain("1.00");
    });

    test("renders empty bar at value 0.0", () => {
      const result = bar(0.0);
      expect(result).toContain("░░░░░░░░░░"); // 10 empty blocks
      expect(result).toContain("0.00");
    });

    test("renders half bar at value 0.5", () => {
      const result = bar(0.5);
      expect(result).toContain("█████░░░░░"); // 5 full, 5 empty
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
      expect(result).toContain("██░░░"); // 2 full, 3 empty
    });

    test("uses custom max", () => {
      const result = bar(5, { max: 10 });
      expect(result).toContain("█████░░░░░"); // 5 full, 5 empty
    });
  });

  // --- bar with color ---

  describe("bar color thresholds", () => {
    test("green color for value >= 0.7", () => {
      delete process.env.NO_COLOR;
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = bar(0.8);
      expect(result).toContain("\x1b[32m");
    });

    test("yellow color for value 0.4-0.69", () => {
      delete process.env.NO_COLOR;
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = bar(0.5);
      expect(result).toContain("\x1b[33m");
    });

    test("red color for value < 0.4", () => {
      delete process.env.NO_COLOR;
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = bar(0.3);
      expect(result).toContain("\x1b[31m");
    });
  });

  // --- section ---

  describe("section", () => {
    test("renders title and rows", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = section("Traits", ["detail_oriented: 0.82", "early_riser: 0.60"]);
      expect(result).toContain("Traits");
      expect(result).toContain("detail_oriented");
    });

    test("renders empty section with No data", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = section("Traits", []);
      expect(result).toContain("Traits");
      expect(result).toContain("No data");
    });
  });

  // --- status ---

  describe("status", () => {
    test("renders success status", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = status("success", "Profile created");
      expect(result).toContain("Profile created");
      expect(result).toContain("✓"); // checkmark
    });

    test("renders error status", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = status("error", "Not found");
      expect(result).toContain("Not found");
      expect(result).toContain("✗"); // cross mark
    });

    test("renders warning status", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = status("warning", "Low confidence");
      expect(result).toContain("Low confidence");
      expect(result).toContain("!");
    });

    test("renders info status", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = status("info", "Tip: run --help");
      expect(result).toContain("Tip: run --help");
      expect(result).toContain("→"); // right arrow
    });
  });

  // --- table ---

  describe("table", () => {
    test("renders aligned columns", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
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
      setNoColor(false);
      const result = table(["Dimension", "Value"], []);
      expect(result).toContain("Dimension");
      expect(result).toContain("Value");
    });
  });

  // --- list ---

  describe("list", () => {
    test("renders numbered list", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = list(["First item", "Second item"]);
      expect(result).toContain("1.");
      expect(result).toContain("First item");
      expect(result).toContain("2.");
      expect(result).toContain("Second item");
    });

    test("renders empty list", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = list([]);
      expect(result).toBe("");
    });
  });

  // --- dim ---

  describe("dim", () => {
    test("returns dimmed text with color", () => {
      delete process.env.NO_COLOR;
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = dim("muted text");
      expect(result).toContain("muted text");
      expect(result).toContain("\x1b[2m");
    });

    test("returns plain text with NO_COLOR", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = dim("muted text");
      expect(result).toBe("muted text");
    });
  });

  // --- emphasis ---

  describe("emphasis", () => {
    test("returns bold text with color", () => {
      delete process.env.NO_COLOR;
      setNoColor(false);
      Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
      const result = emphasis("important");
      expect(result).toContain("important");
      expect(result).toContain("\x1b[1m");
    });

    test("returns plain text with NO_COLOR", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = emphasis("important");
      expect(result).toBe("important");
    });
  });

  // --- renderError ---

  describe("renderError", () => {
    test("renders error with message", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = renderError(new Error("Something failed"));
      expect(result).toContain("Something failed");
    });

    test("renders error with string input", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = renderError("Plain error string");
      expect(result).toContain("Plain error string");
    });

    test("renders error with recovery suggestion", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = renderError(new Error("Not found"), "Run `kai work start` to create a profile.");
      expect(result).toContain("Not found");
      expect(result).toContain("Run `kai work start`");
    });
  });

  // --- divider ---

  describe("divider", () => {
    test("renders horizontal line", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
      const result = divider();
      expect(result).toContain("─"); // box drawings light horizontal
    });
  });

  // --- nextSteps ---

  describe("nextSteps", () => {
    test("renders next steps section", () => {
      process.env.NO_COLOR = "1";
      setNoColor(false);
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
      setNoColor(false);
      const result = nextSteps([]);
      expect(result).toBe("");
    });
  });
});
