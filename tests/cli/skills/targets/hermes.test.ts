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
import { HermesTarget } from "../../../../src/cli/skills/targets/hermes";
import type { McpConfig } from "../../../../src/cli/skills/types";

describe("HermesTarget", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-hermes-test-"));
    configPath = join(tempDir, "config.yaml");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("name is 'hermes'", () => {
    const target = new HermesTarget(tempDir, configPath);
    expect(target.name).toBe("hermes");
  });

  test("capabilities returns correct profile", () => {
    const target = new HermesTarget(tempDir, configPath);
    const caps = target.capabilities();
    expect(caps.skillMd).toBe(true);
    expect(caps.mcp).toBe(true);
    expect(caps.hooks).toBe(false);
    expect(caps.commands).toBe(false);
    expect(caps.terminal).toBe(true);
    expect(caps.skillDirectory).toBe(true);
  });

  test("validateInstallation returns invalid when no manifest", () => {
    const target = new HermesTarget(tempDir, configPath);
    const result = target.validateInstallation();
    expect(result.valid).toBe(false);
  });

  test("installSkills writes skill files and manifest", async () => {
    const target = new HermesTarget(tempDir, configPath);
    const skills = [
      { filename: "SKILL.md", content: "# Kai" },
      { filename: "profile/SKILL.md", content: "# Profile" },
    ];
    const manifest = {
      kaiVersion: "0.11.0",
      generatedAt: new Date().toISOString(),
      skills: { profile: ["profile.read"] },
      target: "hermes",
    };

    await target.installSkills(skills, manifest);

    expect(existsSync(join(tempDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(tempDir, "profile", "SKILL.md"))).toBe(true);
    expect(existsSync(join(tempDir, "manifest.json"))).toBe(true);
  });

  test("configureMcp creates YAML config", async () => {
    const target = new HermesTarget(tempDir, configPath);
    const config: McpConfig = { command: "/usr/local/bin/kai", args: ["mcp", "serve"] };

    await target.configureMcp(config);

    expect(existsSync(configPath)).toBe(true);
    const raw = readFileSync(configPath, "utf-8");
    expect(raw).toContain("mcp_servers");
    expect(raw).toContain("kai");
    expect(raw).toContain("/usr/local/bin/kai");
  });

  test("configureMcp preserves existing YAML keys", async () => {
    writeFileSync(configPath, "existing_key: value\n");
    const target = new HermesTarget(tempDir, configPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    await target.configureMcp(config);

    const raw = readFileSync(configPath, "utf-8");
    expect(raw).toContain("existing_key");
    expect(raw).toContain("mcp_servers");
  });

  test("configureMcp throws on conflict without force", async () => {
    writeFileSync(
      configPath,
      "mcp_servers:\n  kai:\n    command: different\n    args: []\n",
    );
    const target = new HermesTarget(tempDir, configPath);
    const config: McpConfig = { command: "kai", args: ["mcp", "serve"] };

    await expect(target.configureMcp(config)).rejects.toThrow(/conflict/i);
  });

  test("removeMcp removes kai entry from YAML config", async () => {
    writeFileSync(
      configPath,
      "mcp_servers:\n  kai:\n    command: kai\n    args: [mcp, serve]\n  other:\n    command: other\n",
    );
    const target = new HermesTarget(tempDir, configPath);

    await target.removeMcp();

    const raw = readFileSync(configPath, "utf-8");
    expect(raw).not.toContain("command: kai");
    expect(raw).toContain("other");
  });

  test("removeMcp handles missing config gracefully", async () => {
    const target = new HermesTarget(tempDir, join(tempDir, "nope.yaml"));
    await target.removeMcp(); // should not throw
  });

  test("removeSkills removes skill directory", async () => {
    const target = new HermesTarget(tempDir, configPath);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, "SKILL.md"), "# Kai");

    await target.removeSkills();

    expect(existsSync(tempDir)).toBe(false);
  });
});
