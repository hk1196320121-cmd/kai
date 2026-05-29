import { describe, test, expect } from "bun:test";
import {
  getTarget,
  getTargetNames,
  detectPlatforms,
  validateTargetName,
} from "../../../../src/cli/skills/targets/registry";

describe("TargetRegistry", () => {
  test("getTargetNames returns all registered targets", () => {
    const names = getTargetNames();
    expect(names).toContain("claude-code");
    expect(names).toContain("hermes");
    expect(names).toContain("gemini-cli");
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  test("getTarget returns claude-code adapter", () => {
    const target = getTarget("claude-code");
    expect(target.name).toBe("claude-code");
    expect(target.capabilities().hooks).toBe(true);
    expect(target.capabilities().commands).toBe(true);
  });

  test("getTarget throws on unknown target", () => {
    expect(() => getTarget("unknown")).toThrow(/not registered/i);
  });

  test("validateTargetName accepts valid names", () => {
    expect(() => validateTargetName("claude-code")).not.toThrow();
    expect(() => validateTargetName("hermes")).not.toThrow();
    expect(() => validateTargetName("gemini-cli")).not.toThrow();
  });

  test("validateTargetName rejects empty string", () => {
    expect(() => validateTargetName("")).toThrow(/required/i);
  });

  test("validateTargetName rejects names with special characters", () => {
    expect(() => validateTargetName("../evil")).toThrow(/invalid/i);
    expect(() => validateTargetName("test;rm")).toThrow(/invalid/i);
    expect(() => validateTargetName("a b")).toThrow(/invalid/i);
  });

  test("detectPlatforms returns only claude-code when only ~/.claude/ exists", () => {
    const detected = detectPlatforms({
      "claude-code": () => true,
      hermes: () => false,
      "gemini-cli": () => false,
    });
    expect(detected).toEqual(["claude-code"]);
  });

  test("detectPlatforms returns all when all detected", () => {
    const detected = detectPlatforms({
      "claude-code": () => true,
      hermes: () => true,
      "gemini-cli": () => true,
    });
    expect(detected).toEqual(["claude-code", "hermes", "gemini-cli"]);
  });
});
