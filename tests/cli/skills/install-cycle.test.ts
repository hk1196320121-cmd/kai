import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installSkills } from "../../../src/cli/skills/commands/install";

const TEST_DIR = join(tmpdir(), `kai-test-${Date.now()}`);
const SKILLS_DIR = join(TEST_DIR, "skills", "kai");

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

const testPaths = {
  claudeJsonPath: join(TEST_DIR, "claude.json"),
  settingsPath: join(TEST_DIR, "settings.json"),
  commandsDir: join(TEST_DIR, "commands", "kai"),
  hooksDir: join(TEST_DIR, "hooks", "kai"),
};

describe("install cycle integration", () => {
  test("install generates skill files", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const exitCode = await installSkills({
      target: "claude-code",
      force: true,
      installPath: SKILLS_DIR,
      _testPaths: testPaths,
    });
    expect(exitCode).toBe(0);
    expect(existsSync(join(SKILLS_DIR, "SKILL.md"))).toBe(true);
    expect(existsSync(join(SKILLS_DIR, "manifest.json"))).toBe(true);
  });

  test("manifest has correct structure", () => {
    const manifest = JSON.parse(readFileSync(join(SKILLS_DIR, "manifest.json"), "utf-8"));
    expect(manifest.kaiVersion).toBeDefined();
    expect(manifest.generatedAt).toBeDefined();
    expect(Object.keys(manifest.skills).length).toBe(7);
  });

  test("re-install with --force is idempotent", async () => {
    const exitCode = await installSkills({
      target: "claude-code",
      force: true,
      installPath: SKILLS_DIR,
      _testPaths: testPaths,
    });
    expect(exitCode).toBe(0);
    const manifest = JSON.parse(readFileSync(join(SKILLS_DIR, "manifest.json"), "utf-8"));
    expect(Object.keys(manifest.skills).length).toBe(7);
  });
});
