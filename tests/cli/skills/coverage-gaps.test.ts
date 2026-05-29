import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeCodeTarget } from "../../../src/cli/skills/targets/claude-code";
import { getHookConfigs, writeHookScripts } from "../../../src/cli/skills/hooks";

// ---------------------------------------------------------------------------
// writeHookScripts + getHookConfigs
// ---------------------------------------------------------------------------

describe("writeHookScripts + getHookConfigs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-hooks-io-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writeHookScripts creates both .cjs files on disk", () => {
    writeHookScripts(tempDir);
    expect(existsSync(join(tempDir, "kai-session-start.cjs"))).toBe(true);
    expect(existsSync(join(tempDir, "kai-auto-observe.cjs"))).toBe(true);
  });

  test("written hook scripts contain shebang", () => {
    writeHookScripts(tempDir);
    const content = readFileSync(join(tempDir, "kai-session-start.cjs"), "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  test("getHookConfigs returns 2 configs with correct event types", () => {
    const configs = getHookConfigs(tempDir);
    expect(configs).toHaveLength(2);
    const eventTypes = configs.map((c) => c.eventType).sort();
    expect(eventTypes).toEqual(["PostToolUse", "SessionStart"]);
  });

  test("getHookConfigs SessionStart has no matcher", () => {
    const configs = getHookConfigs(tempDir);
    const sessionStart = configs.find((c) => c.eventType === "SessionStart")!;
    expect(sessionStart.matcher).toBeUndefined();
  });

  test("getHookConfigs PostToolUse has matcher and timeout", () => {
    const configs = getHookConfigs(tempDir);
    const postToolUse = configs.find((c) => c.eventType === "PostToolUse")!;
    expect(postToolUse.matcher).toBe("Bash|Read|Edit|Write");
    expect(postToolUse.timeout).toBe(10);
  });

  test("getHookConfigs command references hooksDir", () => {
    const configs = getHookConfigs("/tmp/test-hooks");
    for (const config of configs) {
      expect(config.command).toContain("/tmp/test-hooks");
    }
  });
});

// ---------------------------------------------------------------------------
// ClaudeCodeTarget: constructor defaults
// ---------------------------------------------------------------------------

describe("ClaudeCodeTarget constructor defaults", () => {
  test("default commandsDir includes 'commands/kai'", () => {
    const target = new ClaudeCodeTarget("/tmp/skills");
    expect(target.commandsDir).toContain("commands");
    expect(target.commandsDir).toContain("kai");
  });

  test("default hooksDir includes 'hooks/kai'", () => {
    const target = new ClaudeCodeTarget("/tmp/skills");
    expect(target.hooksDir).toContain("hooks");
    expect(target.hooksDir).toContain("kai");
  });

  test("custom commandsDir is used", () => {
    const target = new ClaudeCodeTarget(
      "/tmp/skills",
      undefined,
      undefined,
      "/custom/commands",
      "/custom/hooks",
    );
    expect(target.commandsDir).toBe("/custom/commands");
    expect(target.hooksDir).toBe("/custom/hooks");
  });
});

// ---------------------------------------------------------------------------
// ClaudeCodeTarget: mergeSettingsHook
// ---------------------------------------------------------------------------

describe("ClaudeCodeTarget: mergeSettingsHook", () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-merge-hook-"));
    settingsPath = join(tempDir, "settings.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates settings.json with hooks when file does not exist", async () => {
    const target = new ClaudeCodeTarget(
      tempDir,
      undefined,
      settingsPath,
    );
    await target.mergeSettingsHook({
      eventType: "SessionStart",
      command: 'bun "/hooks/kai-session-start.cjs"',
      hookId: "kai-session-start",
    });
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("kai-session-start");
  });

  test("merges into existing settings without losing other fields", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ someOtherField: true, hooks: {} }),
    );
    const target = new ClaudeCodeTarget(
      tempDir,
      undefined,
      settingsPath,
    );
    await target.mergeSettingsHook({
      eventType: "SessionStart",
      command: 'bun "/hooks/kai-session-start.cjs"',
      hookId: "kai-session-start",
    });
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.someOtherField).toBe(true);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  test("throws on invalid JSON in settings.json", async () => {
    writeFileSync(settingsPath, "not json {{{");
    const target = new ClaudeCodeTarget(
      tempDir,
      undefined,
      settingsPath,
    );
    await expect(
      target.mergeSettingsHook({
        eventType: "SessionStart",
        command: 'bun "/hooks/test.cjs"',
        hookId: "kai-session-start",
      }),
    ).rejects.toThrow(/Cannot parse/);
  });
});

// ---------------------------------------------------------------------------
// ClaudeCodeTarget: removeSettingsHooks
// ---------------------------------------------------------------------------

describe("ClaudeCodeTarget: removeSettingsHooks", () => {
  let tempDir: string;
  let settingsPath: string;
  let hooksDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-remove-hooks-"));
    settingsPath = join(tempDir, "settings.json");
    hooksDir = join(tempDir, "hooks", "kai");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("removes Kai hooks from settings.json", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: "command", command: `bun "${join(hooksDir, "kai-session-start.cjs")}"` },
              ],
            },
          ],
        },
      }),
    );
    const target = new ClaudeCodeTarget(tempDir, undefined, settingsPath, undefined, hooksDir);
    await target.removeSettingsHooks();
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart).toHaveLength(0);
  });

  test("preserves non-Kai hooks", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [{ type: "command", command: "other-hook" }],
            },
          ],
        },
      }),
    );
    const target = new ClaudeCodeTarget(tempDir, undefined, settingsPath, undefined, hooksDir);
    await target.removeSettingsHooks();
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });

  test("handles missing settings.json gracefully", async () => {
    const target = new ClaudeCodeTarget(tempDir, undefined, settingsPath, undefined, hooksDir);
    // Should not throw
    await target.removeSettingsHooks();
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("handles invalid JSON in settings.json gracefully", async () => {
    writeFileSync(settingsPath, "not json {{{");
    const target = new ClaudeCodeTarget(tempDir, undefined, settingsPath, undefined, hooksDir);
    // Should not throw
    await target.removeSettingsHooks();
  });
});

// ---------------------------------------------------------------------------
// install-cycle: verify commands and hooks generated
// ---------------------------------------------------------------------------

describe("install cycle: commands + hooks generation", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-install-cmds-"));
    skillsDir = join(tempDir, "skills", "kai");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("install generates workflow command .md files", async () => {
    const { installSkills } = await import("../../../src/cli/skills/commands/install");
    const commandsDir = join(tempDir, "commands", "kai");
    const hooksDir = join(tempDir, "hooks", "kai");

    await installSkills({
      target: "claude-code",
      force: true,
      installPath: skillsDir,
      _testPaths: {
        claudeJsonPath: join(tempDir, "claude.json"),
        settingsPath: join(tempDir, "settings.json"),
        commandsDir,
        hooksDir,
      },
    });

    // Check command files
    expect(existsSync(commandsDir)).toBe(true);
    const cmdFiles = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
    expect(cmdFiles.length).toBeGreaterThanOrEqual(8);

    // Check hook files
    expect(existsSync(hooksDir)).toBe(true);
    const hookFiles = readdirSync(hooksDir).filter((f) => f.endsWith(".cjs"));
    expect(hookFiles.length).toBe(2);
  });

  test("installed command files have /kai heading", async () => {
    const { installSkills } = await import("../../../src/cli/skills/commands/install");
    const commandsDir = join(tempDir, "commands", "kai");

    await installSkills({
      target: "claude-code",
      force: true,
      installPath: skillsDir,
      _testPaths: {
        claudeJsonPath: join(tempDir, "claude.json"),
        settingsPath: join(tempDir, "settings.json"),
        commandsDir,
        hooksDir: join(tempDir, "hooks", "kai"),
      },
    });

    const files = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const content = readFileSync(join(commandsDir, f), "utf-8");
      expect(content).toMatch(/^# \/kai/);
    }
  });
});

// ---------------------------------------------------------------------------
// templates: mcpToolName unit test
// ---------------------------------------------------------------------------

describe("mcpToolName", () => {
  test("replaces dots with underscores", async () => {
    const { mcpToolName } = await import("../../../src/cli/skills/templates");
    expect(mcpToolName("profile.read")).toBe("profile_read");
    expect(mcpToolName("kai_work_recommend")).toBe("kai_work_recommend");
    expect(mcpToolName("observe.submit")).toBe("observe_submit");
  });

  test("handles no-dot tool IDs", async () => {
    const { mcpToolName } = await import("../../../src/cli/skills/templates");
    expect(mcpToolName("kai_work_recommend")).toBe("kai_work_recommend");
  });
});
