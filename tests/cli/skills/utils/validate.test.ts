import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateSkillManifest } from "../../../../src/cli/skills/utils/validate";

describe("validateSkillManifest", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-validate-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns invalid when no manifest exists", () => {
    const result = validateSkillManifest(tempDir, "hermes");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("hermes");
  });

  test("returns invalid when manifest has invalid JSON", () => {
    writeFileSync(join(tempDir, "manifest.json"), "not json");
    const result = validateSkillManifest(tempDir, "test-target");
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("invalid JSON")]));
  });

  test("returns invalid when manifest missing kaiVersion", () => {
    writeFileSync(join(tempDir, "manifest.json"), JSON.stringify({ skills: { a: [] } }));
    const result = validateSkillManifest(tempDir, "test-target");
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("kaiVersion")]));
  });

  test("returns valid with warnings for empty skills", () => {
    writeFileSync(join(tempDir, "manifest.json"), JSON.stringify({
      kaiVersion: "0.11.0",
      skills: {},
    }));
    const result = validateSkillManifest(tempDir, "test-target");
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("returns valid for complete manifest", () => {
    writeFileSync(join(tempDir, "manifest.json"), JSON.stringify({
      kaiVersion: "0.11.0",
      skills: { profile: ["profile.read"] },
    }));
    const result = validateSkillManifest(tempDir, "test-target");
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});
