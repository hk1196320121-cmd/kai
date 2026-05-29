import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HermesTarget } from "../../../../src/cli/skills/targets/hermes";
import { GeminiCliTarget } from "../../../../src/cli/skills/targets/gemini-cli";
import { ClaudeCodeTarget } from "../../../../src/cli/skills/targets/claude-code";

describe("adapter.removeSkills() + removeMcp()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-uninstall-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("ClaudeCodeTarget.removeSkills cleans up commands, hooks, and skill dir", async () => {
    const skillsDir = join(tempDir, "skills", "kai");
    const commandsDir = join(tempDir, "commands", "kai");
    const hooksDir = join(tempDir, "hooks", "kai");
    const settingsPath = join(tempDir, "settings.json");

    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(commandsDir, { recursive: true });
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(join(skillsDir, "SKILL.md"), "# test");
    writeFileSync(join(commandsDir, "test.md"), "test");
    writeFileSync(join(hooksDir, "test.cjs"), "test");
    writeFileSync(settingsPath, "{}");

    const target = new ClaudeCodeTarget(skillsDir, undefined, settingsPath, commandsDir, hooksDir);
    await target.removeSkills();

    expect(existsSync(commandsDir)).toBe(false);
    expect(existsSync(hooksDir)).toBe(false);
    expect(existsSync(skillsDir)).toBe(false);
  });

  test("HermesTarget.removeSkills + removeMcp full cleanup", async () => {
    const skillsDir = join(tempDir, "skills", "kai");
    const configPath = join(tempDir, "config.yaml");

    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "SKILL.md"), "# test");
    writeFileSync(configPath, "mcp_servers:\n  kai:\n    command: kai\n    args: [mcp, serve]\n");

    const target = new HermesTarget(skillsDir, configPath);
    await target.removeSkills();
    await target.removeMcp();

    expect(existsSync(skillsDir)).toBe(false);
    const raw = readFileSync(configPath, "utf-8");
    expect(raw).not.toContain("command: kai");
  });

  test("GeminiCliTarget.removeSkills + removeMcp full cleanup", async () => {
    const skillsDir = join(tempDir, "skills", "kai");
    const settingsPath = join(tempDir, "settings.json");

    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "SKILL.md"), "# test");
    writeFileSync(settingsPath, JSON.stringify({
      mcpServers: { kai: { command: "kai", args: ["mcp", "serve"] } },
    }));

    const target = new GeminiCliTarget(skillsDir, settingsPath);
    await target.removeSkills();
    await target.removeMcp();

    expect(existsSync(skillsDir)).toBe(false);
    const content = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(content.mcpServers.kai).toBeUndefined();
  });
});
