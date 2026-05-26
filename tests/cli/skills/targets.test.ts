import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeCodeTarget } from "../../../src/cli/skills/targets/claude-code";
import type { McpConfig, ValidationResult } from "../../../src/cli/skills/types";

describe("ClaudeCodeTarget", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-skills-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("name is 'claude-code'", () => {
    const target = new ClaudeCodeTarget(tempDir);
    expect(target.name).toBe("claude-code");
  });

  test("skillInstallPath returns the provided path", () => {
    const target = new ClaudeCodeTarget(tempDir);
    expect(target.skillInstallPath).toBe(tempDir);
  });

  test("validateInstallation returns valid when manifest exists and matches", () => {
    const target = new ClaudeCodeTarget(tempDir);
    const manifest = { kaiVersion: "0.9.1", generatedAt: new Date().toISOString(), skills: {} };
    mkdirSync(join(tempDir), { recursive: true });
    writeFileSync(join(tempDir, "manifest.json"), JSON.stringify(manifest));

    const result = target.validateInstallation();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("validateInstallation returns invalid when no manifest", () => {
    const target = new ClaudeCodeTarget(tempDir);
    const result = target.validateInstallation();
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("configureMcp creates claude.json if not exists", async () => {
    const claudeJsonPath = join(tempDir, "claude.json");
    const target = new ClaudeCodeTarget(tempDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    await target.configureMcp(config);

    expect(existsSync(claudeJsonPath)).toBe(true);
    const content = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(content.mcpServers.kai.command).toBe("kai");
    expect(content.mcpServers.kai.args).toEqual(["mcp", "serve"]);
  });

  test("configureMcp warns on conflicting entry", async () => {
    const claudeJsonPath = join(tempDir, "claude.json");
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: { kai: { command: "different", args: [] } },
    }));
    const target = new ClaudeCodeTarget(tempDir, claudeJsonPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    await target.configureMcp(config, true); // force=true to skip prompt
    const content = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(content.mcpServers.kai.command).toBe("kai");
  });

  test("removeMcp removes kai entry from claude.json", async () => {
    const claudeJsonPath = join(tempDir, "claude.json");
    writeFileSync(claudeJsonPath, JSON.stringify({
      mcpServers: {
        kai: { command: "kai", args: ["mcp", "serve"] },
        other: { command: "other", args: [] },
      },
    }));
    const target = new ClaudeCodeTarget(tempDir, claudeJsonPath);

    await target.removeMcp();
    const content = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    expect(content.mcpServers.kai).toBeUndefined();
    expect(content.mcpServers.other).toBeDefined();
  });

  test("removeMcp handles missing claude.json gracefully", async () => {
    const claudeJsonPath = join(tempDir, "nonexistent.json");
    const target = new ClaudeCodeTarget(tempDir, claudeJsonPath);

    await target.removeMcp();
    // Should not throw
  });
});
