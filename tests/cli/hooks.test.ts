import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerHooksCommands } from "../../src/cli/hooks";

describe("hooks CLI commands", () => {
  let tmpDir: string;
  let hooksDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kai-cli-hooks-"));
    hooksDir = join(tmpDir, "hooks");
    settingsPath = join(tmpDir, "settings.json");
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function createProgram(): Command {
    const program = new Command();
    program.exitOverride();
    registerHooksCommands(program);
    return program;
  }

  test("registers 'hooks' subcommand", () => {
    const program = createProgram();
    const cmds = program.commands.map((c) => c.name());
    expect(cmds).toContain("hooks");
  });

  test("registers install, uninstall, status subcommands", () => {
    const program = createProgram();
    const hooks = program.commands.find((c) => c.name() === "hooks");
    expect(hooks).toBeDefined();
    const subCmds = hooks!.commands.map((c) => c.name());
    expect(subCmds).toContain("install");
    expect(subCmds).toContain("uninstall");
    expect(subCmds).toContain("status");
  });

  test("install writes scripts and settings", () => {
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => captured.push(args.join(" "));

    try {
      const program = createProgram();
      program.parse([
        "node",
        "test",
        "hooks",
        "install",
        "--hooks-dir",
        hooksDir,
        "--settings",
        settingsPath,
      ]);
    } catch {
      // exitOverride may throw
    } finally {
      console.log = origLog;
    }

    expect(existsSync(join(hooksDir, "kai-session-start.cjs"))).toBe(true);
    expect(existsSync(join(hooksDir, "kai-auto-observe.cjs"))).toBe(true);
    expect(existsSync(join(hooksDir, "kai-stop.cjs"))).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
  });

  test("uninstall removes hooks from settings", () => {
    // Install first
    const program1 = createProgram();
    try {
      program1.parse([
        "node",
        "test",
        "hooks",
        "install",
        "--hooks-dir",
        hooksDir,
        "--settings",
        settingsPath,
      ]);
    } catch {}

    // Uninstall
    const program2 = createProgram();
    try {
      program2.parse([
        "node",
        "test",
        "hooks",
        "uninstall",
        "--settings",
        settingsPath,
      ]);
    } catch {}

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const allCmds = JSON.stringify(settings.hooks || {});
    expect(allCmds).not.toMatch(/kai-session-start/);
  });

  test("status reports scripts and settings", () => {
    // Install first
    const program1 = createProgram();
    try {
      program1.parse([
        "node",
        "test",
        "hooks",
        "install",
        "--hooks-dir",
        hooksDir,
        "--settings",
        settingsPath,
      ]);
    } catch {}

    // Status
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => captured.push(args.join(" "));

    try {
      const program2 = createProgram();
      program2.parse([
        "node",
        "test",
        "hooks",
        "status",
        "--hooks-dir",
        hooksDir,
        "--settings",
        settingsPath,
      ]);
    } catch {
    } finally {
      console.log = origLog;
    }

    const output = captured.join("\n");
    expect(output).toContain("kai-session-start.cjs");
    expect(output).toContain("kai-auto-observe.cjs");
    expect(output).toContain("kai-stop.cjs");
  });
});
