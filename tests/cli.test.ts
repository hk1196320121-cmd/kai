import { describe, test, expect } from "bun:test";
import { spawn } from "child_process";

function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("bun", ["run", "src/cli/index.ts", ...args], { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

describe("CLI", () => {
  test("--help shows usage", async () => {
    const { stdout, exitCode } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kai");
  });

  test("profile --help shows subcommands", async () => {
    const { stdout, exitCode } = await runCli(["profile", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("bootstrap");
    expect(stdout).toContain("read");
  });

  test("observe --help shows options", async () => {
    const { stdout, exitCode } = await runCli(["observe", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("daily");
  });

  test("unknown command shows error", async () => {
    const { exitCode, stderr } = await runCli(["nonexistent"]);
    expect(exitCode).not.toBe(0);
  });
});
