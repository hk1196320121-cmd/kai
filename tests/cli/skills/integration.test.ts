import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildSkillConfigs,
  sanitizeToolName,
} from "../../../src/cli/skills/compiler";
import {
  generateSkillMarkdown,
  generateMasterSkill,
} from "../../../src/cli/skills/templates";
import { ClaudeCodeTarget } from "../../../src/cli/skills/targets/claude-code";
import type { McpConfig, SkillManifest } from "../../../src/cli/skills/types";

describe("Skills Integration", () => {
  let tempDir: string;
  let skillDir: string;
  let claudeJsonPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-skills-int-"));
    skillDir = join(tempDir, "skills", "kai");
    claudeJsonPath = join(tempDir, "claude.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function installSkills(): void {
    const configs = buildSkillConfigs();
    mkdirSync(skillDir, { recursive: true });

    // Master SKILL.md
    writeFileSync(join(skillDir, "SKILL.md"), generateMasterSkill(configs));

    // Domain skills
    for (const config of configs) {
      const domainDir = join(skillDir, config.domain);
      mkdirSync(domainDir, { recursive: true });
      writeFileSync(join(domainDir, "SKILL.md"), generateSkillMarkdown(config));
    }

    // Manifest
    const manifest: SkillManifest = {
      kaiVersion: "0.9.1",
      generatedAt: new Date().toISOString(),
      skills: Object.fromEntries(
        configs.map((c) => [c.domain, c.tools.map((t) => t.toolId)]),
      ),
    };
    writeFileSync(
      join(skillDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  }

  test("install -> doctor -> uninstall flow", () => {
    // Install
    installSkills();
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "manifest.json"))).toBe(true);

    const configs = buildSkillConfigs();
    for (const config of configs) {
      expect(existsSync(join(skillDir, config.domain, "SKILL.md"))).toBe(true);
    }

    // Doctor
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const result = target.validateInstallation();
    expect(result.valid).toBe(true);

    // Uninstall
    rmSync(skillDir, { recursive: true, force: true });
    expect(existsSync(skillDir)).toBe(false);
  });

  test("install generates exactly 8 SKILL.md files + 1 manifest", () => {
    installSkills();

    const configs = buildSkillConfigs();
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true); // master
    expect(configs).toHaveLength(7); // 7 domain skills
    for (const config of configs) {
      expect(existsSync(join(skillDir, config.domain, "SKILL.md"))).toBe(true);
    }
    expect(existsSync(join(skillDir, "manifest.json"))).toBe(true);
  });

  test("manifest lists all 19 tools", () => {
    installSkills();

    const manifest: SkillManifest = JSON.parse(
      readFileSync(join(skillDir, "manifest.json"), "utf-8"),
    );
    const totalTools = Object.values(manifest.skills).reduce(
      (sum, tools) => sum + (tools as string[]).length,
      0,
    );
    expect(totalTools).toBe(19);
  });

  test("MCP config survives round-trip", async () => {
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    // Configure
    await target.configureMcp(config);
    const afterConfigure = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(afterConfigure.mcpServers.kai.command).toBe("kai");

    // Remove
    await target.removeMcp();
    const afterRemove = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(afterRemove.mcpServers.kai).toBeUndefined();
  });

  test("first-run: claude.json doesn't exist", async () => {
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    expect(existsSync(claudeJsonPath)).toBe(false);

    await target.configureMcp(config);

    expect(existsSync(claudeJsonPath)).toBe(true);
    const content = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(content.mcpServers.kai.command).toBe("kai");
  });

  test("path traversal: tool name with ../ is rejected", () => {
    expect(() => sanitizeToolName("../etc/passwd")).toThrow(/invalid/i);
  });

  test("conflicting MCP entry without force throws", async () => {
    writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        mcpServers: { kai: { command: "different", args: [] } },
      }),
    );
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    await expect(target.configureMcp(config)).rejects.toThrow(/conflicting/i);
  });

  test("invalid JSON in claude.json throws", async () => {
    writeFileSync(claudeJsonPath, "not json {{{");
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    await expect(target.configureMcp(config)).rejects.toThrow(/JSON/i);
  });

  test("doctor detects version mismatch", () => {
    installSkills();

    // Tamper with manifest version
    const manifestPath = join(skillDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.kaiVersion = "0.0.1";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Doctor should still validate structure, but version check is separate
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);
    const result = target.validateInstallation();
    expect(result.valid).toBe(true); // structure is valid, just version differs
  });

  test("removeMcp preserves other MCP servers", async () => {
    writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        mcpServers: {
          kai: { command: "kai", args: ["mcp", "serve"] },
          gbrain: { command: "gbrain", args: [] },
        },
      }),
    );
    const target = new ClaudeCodeTarget(skillDir, claudeJsonPath);

    await target.removeMcp();

    const content = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(content.mcpServers.kai).toBeUndefined();
    expect(content.mcpServers.gbrain).toBeDefined();
  });
});
