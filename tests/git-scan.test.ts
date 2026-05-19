import { describe, test, expect } from "bun:test";
import { scanGitHistory } from "../src/cli/work";

describe("scanGitHistory", () => {
  test("returns empty result when not in a git repo", () => {
    const result = scanGitHistory("/tmp/nonexistent-path-" + Date.now());
    expect(result.observations.length).toBe(0);
    expect(result.traits.length).toBe(0);
  });

  test("returns observations from real git repo", () => {
    const result = scanGitHistory(process.cwd());
    if (result.observations.length > 0) {
      expect(result.observations.every((o) => o.source === "coldstart")).toBe(true);
      expect(result.observations.every((o) => o.key.startsWith("coldstart:git."))).toBe(true);
    }
  });

  test("git scan observations have confidence 4-5", () => {
    const result = scanGitHistory(process.cwd());
    for (const obs of result.observations) {
      expect(obs.confidence).toBeGreaterThanOrEqual(4);
      expect(obs.confidence).toBeLessThanOrEqual(5);
    }
  });
});
