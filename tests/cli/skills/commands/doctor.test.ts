import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HermesTarget } from "../../../../src/cli/skills/targets/hermes";
import { GeminiCliTarget } from "../../../../src/cli/skills/targets/gemini-cli";
import { ClaudeCodeTarget } from "../../../../src/cli/skills/targets/claude-code";

describe("adapter.validateMcp()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-doctor-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("ClaudeCodeTarget.validateMcp returns warning when no ~/.claude.json", () => {
    const target = new ClaudeCodeTarget(
      join(tempDir, "skills"),
      join(tempDir, "no-claude.json"),
    );
    const result = target.validateMcp();
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("ClaudeCodeTarget.validateMcp returns error when kai not registered", () => {
    const claudeJson = join(tempDir, "claude.json");
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: {} }));
    const target = new ClaudeCodeTarget(
      join(tempDir, "skills"),
      claudeJson,
    );
    const result = target.validateMcp();
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("kai");
  });

  test("ClaudeCodeTarget.validateMcp returns valid when kai is registered", () => {
    const claudeJson = join(tempDir, "claude.json");
    writeFileSync(claudeJson, JSON.stringify({
      mcpServers: { kai: { command: "kai", args: ["mcp", "serve"] } },
    }));
    const target = new ClaudeCodeTarget(
      join(tempDir, "skills"),
      claudeJson,
    );
    const result = target.validateMcp();
    expect(result.valid).toBe(true);
  });

  test("HermesTarget.validateMcp returns error when kai not in YAML config", () => {
    const configPath = join(tempDir, "config.yaml");
    writeFileSync(configPath, "mcp_servers:\n  other:\n    command: other\n");
    const target = new HermesTarget(join(tempDir, "skills"), configPath);
    const result = target.validateMcp();
    expect(result.valid).toBe(false);
  });

  test("HermesTarget.validateMcp returns valid when kai is in YAML config", () => {
    const configPath = join(tempDir, "config.yaml");
    writeFileSync(configPath, "mcp_servers:\n  kai:\n    command: kai\n    args: [mcp, serve]\n");
    const target = new HermesTarget(join(tempDir, "skills"), configPath);
    const result = target.validateMcp();
    expect(result.valid).toBe(true);
  });

  test("GeminiCliTarget.validateMcp returns error when kai not registered", () => {
    const settingsPath = join(tempDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ mcpServers: {} }));
    const target = new GeminiCliTarget(join(tempDir, "skills"), settingsPath);
    const result = target.validateMcp();
    expect(result.valid).toBe(false);
  });

  test("GeminiCliTarget.validateMcp returns valid when kai is registered", () => {
    const settingsPath = join(tempDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      mcpServers: { kai: { command: "kai", args: ["mcp", "serve"] } },
    }));
    const target = new GeminiCliTarget(join(tempDir, "skills"), settingsPath);
    const result = target.validateMcp();
    expect(result.valid).toBe(true);
  });
});
