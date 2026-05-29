import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GeminiCliTarget } from "../../../../src/cli/skills/targets/gemini-cli";
import type { McpConfig } from "../../../../src/cli/skills/types";

describe("GeminiCliTarget", () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-gemini-test-"));
    settingsPath = join(tempDir, "settings.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("name is 'gemini-cli'", () => {
    const target = new GeminiCliTarget(tempDir, settingsPath);
    expect(target.name).toBe("gemini-cli");
  });

  test("capabilities returns correct profile", () => {
    const target = new GeminiCliTarget(tempDir, settingsPath);
    const caps = target.capabilities();
    expect(caps.skillMd).toBe(true);
    expect(caps.mcp).toBe(true);
    expect(caps.hooks).toBe(false);
    expect(caps.commands).toBe(false);
    expect(caps.terminal).toBe(true);
    expect(caps.skillDirectory).toBe(true);
  });

  test("validateInstallation returns invalid when no manifest", () => {
    const target = new GeminiCliTarget(tempDir, settingsPath);
    const result = target.validateInstallation();
    expect(result.valid).toBe(false);
  });

  test("installSkills writes skill files and manifest", async () => {
    const target = new GeminiCliTarget(tempDir, settingsPath);
    const skills = [
      { filename: "SKILL.md", content: "# Kai" },
      { filename: "observe/SKILL.md", content: "# Observe" },
    ];
    const manifest = {
      kaiVersion: "0.11.0",
      generatedAt: new Date().toISOString(),
      skills: { observe: ["observe.submit"] },
      target: "gemini-cli",
    };

    await target.installSkills(skills, manifest);

    expect(existsSync(join(tempDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(tempDir, "observe", "SKILL.md"))).toBe(true);
    expect(existsSync(join(tempDir, "manifest.json"))).toBe(true);
  });

  test("configureMcp creates settings.json with mcpServers", async () => {
    const target = new GeminiCliTarget(tempDir, settingsPath);
    const config: McpConfig = { command: "/usr/local/bin/kai", args: ["mcp", "serve"] };

    await target.configureMcp(config);

    expect(existsSync(settingsPath)).toBe(true);
    const content = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(content.mcpServers.kai.command).toBe("/usr/local/bin/kai");
  });

  test("configureMcp preserves existing settings keys", async () => {
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark", mcpServers: {} }));
    const target = new GeminiCliTarget(tempDir, settingsPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    await target.configureMcp(config);

    const content = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(content.theme).toBe("dark");
    expect(content.mcpServers.kai.command).toBe("kai");
  });

  test("removeMcp removes kai entry from settings.json", async () => {
    writeFileSync(settingsPath, JSON.stringify({
      mcpServers: {
        kai: { command: "kai", args: ["mcp", "serve"] },
        other: { command: "other", args: [] },
      },
    }));
    const target = new GeminiCliTarget(tempDir, settingsPath);

    await target.removeMcp();

    const content = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(content.mcpServers.kai).toBeUndefined();
    expect(content.mcpServers.other).toBeDefined();
  });

  test("removeMcp handles missing file gracefully", async () => {
    const target = new GeminiCliTarget(tempDir, join(tempDir, "nope.json"));
    await target.removeMcp(); // should not throw
  });

  test("removeSkills removes skill directory", async () => {
    const target = new GeminiCliTarget(tempDir, settingsPath);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, "SKILL.md"), "# Kai");

    await target.removeSkills();

    expect(existsSync(tempDir)).toBe(false);
  });

  test("validateMcp returns error for malformed JSON", () => {
    writeFileSync(settingsPath, "not valid json {{{");
    const target = new GeminiCliTarget(tempDir, settingsPath);
    const result = target.validateMcp();
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Cannot parse");
  });

  test("configureMcp throws for malformed JSON", async () => {
    writeFileSync(settingsPath, "not valid json {{{");
    const target = new GeminiCliTarget(tempDir, settingsPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };
    await expect(target.configureMcp(config)).rejects.toThrow(/Cannot read/);
  });
});
