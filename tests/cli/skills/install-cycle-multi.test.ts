import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installSkills } from "../../../src/cli/skills/commands/install";

const TEST_DIR = join(tmpdir(), `kai-multi-test-${Date.now()}`);

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("multi-target install cycle", () => {
  test("install to hermes target", async () => {
    const hermesDir = join(TEST_DIR, "hermes", "skills", "kai");
    mkdirSync(hermesDir, { recursive: true });

    const exitCode = await installSkills({
      target: "hermes",
      force: true,
      installPath: hermesDir,
      _testPaths: {
        configPath: join(TEST_DIR, "hermes", "config.yaml"),
      },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(hermesDir, "SKILL.md"))).toBe(true);
  });

  test("install to gemini-cli target", async () => {
    const geminiDir = join(TEST_DIR, "gemini", "skills", "kai");
    mkdirSync(geminiDir, { recursive: true });

    const exitCode = await installSkills({
      target: "gemini-cli",
      force: true,
      installPath: geminiDir,
      _testPaths: {
        settingsPath: join(TEST_DIR, "gemini", "settings.json"),
      },
    });

    expect(exitCode).toBe(0);
    expect(existsSync(join(geminiDir, "SKILL.md"))).toBe(true);
  });

  test("returns error for unregistered target", async () => {
    const result = await installSkills({ target: "unknown-platform", force: true });
    expect(result).toBe(1);
  });

  test("manifest tracks target name", async () => {
    const testDir = join(TEST_DIR, "manifest-test", "skills", "kai");
    mkdirSync(testDir, { recursive: true });

    await installSkills({
      target: "hermes",
      force: true,
      installPath: testDir,
      _testPaths: {
        configPath: join(TEST_DIR, "manifest-test", "config.yaml"),
      },
    });

    const manifest = JSON.parse(readFileSync(join(testDir, "manifest.json"), "utf-8"));
    expect(manifest.target).toBe("hermes");
    expect(manifest.kaiVersion).toBeDefined();
    expect(Object.keys(manifest.skills).length).toBe(7);
  });
});
