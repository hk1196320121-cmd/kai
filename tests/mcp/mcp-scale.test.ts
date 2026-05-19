import { describe, test, expect } from "bun:test";
import { mcpToInternal, internalToMcp } from "../../src/core/profile/mcp-scale";

describe("mcpToInternal", () => {
  test("0 maps to 1", () => {
    expect(mcpToInternal(0)).toBe(1);
  });

  test("1 maps to 10", () => {
    expect(mcpToInternal(1)).toBe(10);
  });

  test("0.5 maps to approximately 5 or 6", () => {
    const result = mcpToInternal(0.5);
    expect(result).toBeGreaterThanOrEqual(5);
    expect(result).toBeLessThanOrEqual(6);
  });

  test("clamps values below 0", () => {
    expect(mcpToInternal(-0.5)).toBe(1);
  });

  test("clamps values above 1", () => {
    expect(mcpToInternal(1.5)).toBe(10);
  });
});

describe("internalToMcp", () => {
  test("1 maps to 0", () => {
    expect(internalToMcp(1)).toBeCloseTo(0, 5);
  });

  test("10 maps to 1", () => {
    expect(internalToMcp(10)).toBeCloseTo(1, 5);
  });

  test("round-trip: mcpToInternal then internalToMcp", () => {
    for (const val of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const roundTripped = internalToMcp(mcpToInternal(val));
      expect(Math.abs(roundTripped - val)).toBeLessThanOrEqual(0.12);
    }
  });
});