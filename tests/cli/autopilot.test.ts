import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerAutopilotCommands } from "../../src/cli/autopilot";
import { KaiDB } from "../../src/db/client";

describe("autopilot CLI commands", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kai-cli-auto-"));
    dbPath = join(tmpDir, "kai.db");
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function createProgram(): Command {
    const program = new Command();
    program.exitOverride(); // Prevent process.exit in tests
    registerAutopilotCommands(program);
    return program;
  }

  test("registers 'autopilot' subcommand", () => {
    const program = createProgram();
    const cmds = program.commands.map((c) => c.name());
    expect(cmds).toContain("autopilot");
  });

  test("registers 'status' subcommand under autopilot", () => {
    const program = createProgram();
    const autopilot = program.commands.find((c) => c.name() === "autopilot");
    expect(autopilot).toBeDefined();
    const subCmds = autopilot!.commands.map((c) => c.name());
    expect(subCmds).toContain("status");
  });

  test("status outputs 'No autopilot sessions' when DB missing", () => {
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => captured.push(args.join(" "));

    try {
      const program = createProgram();
      program.parse([
        "node",
        "test",
        "autopilot",
        "status",
        "--db",
        join(tmpDir, "nope.db"),
      ]);
    } catch {
      // exitOverride may throw
    } finally {
      console.log = origLog;
    }

    const output = captured.join("\n");
    expect(output).toContain("No autopilot sessions");
  });

  test("status shows session when DB has data", () => {
    const kai = new KaiDB(dbPath);
    const db = kai.getDatabase();
    db.query(
      "INSERT INTO autopilot_sessions (session_id, started_at, derivation_status, stopped_at) VALUES (?, datetime('now'), 'completed', datetime('now'))",
    ).run("cli-test-session");
    kai.close();

    const captured: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => captured.push(args.join(" "));

    try {
      const program = createProgram();
      program.parse([
        "node",
        "test",
        "autopilot",
        "status",
        "--db",
        dbPath,
      ]);
    } catch {
      // exitOverride may throw
    } finally {
      console.log = origLog;
    }

    const output = captured.join("\n");
    expect(output).toContain("cli-test-session");
    expect(output).toContain("✓");
  });
});
