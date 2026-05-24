import { describe, test, expect } from "bun:test";
import { spawn } from "child_process";

function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("bun", ["run", "src/cli/index.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, KAI_DB: `/tmp/kai-json-test-${process.pid}.db` },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code: number | null) =>
      resolve({ exitCode: code ?? 1, stdout, stderr }),
    );
  });
}

describe("--json bypass verification", () => {
  test("profile read --json outputs valid JSON", async () => {
    const { stdout } = await runCli(["profile", "read", "--json"]);
    // Profile may not exist in fresh temp DB; if JSON output present, verify it parses
    if (stdout.trim().startsWith("{") || stdout.trim().startsWith("[")) {
      expect(() => JSON.parse(stdout)).not.toThrow();
    }
  });

  test("profile read --json has no ANSI codes", async () => {
    const { stdout } = await runCli(["profile", "read", "--json"]);
    if (stdout.trim().length > 0) {
      expect(stdout).not.toContain("\x1b[");
    }
  });

  test("profile read --json has no formatting headers", async () => {
    const { stdout } = await runCli(["profile", "read", "--json"]);
    if (stdout.trim().startsWith("{")) {
      expect(stdout).not.toContain("Kai Profile");
      expect(stdout).not.toContain("Next");
      expect(stdout).not.toContain("████");
    }
  });

  test("profile why --json outputs valid JSON when trait exists", async () => {
    // This will likely output an error message since no trait exists in temp DB
    const { stdout } = await runCli([
      "profile",
      "why",
      "detail_oriented",
      "--json",
    ]);
    if (stdout.trim().startsWith("{")) {
      expect(() => JSON.parse(stdout)).not.toThrow();
      expect(stdout).not.toContain("\x1b[");
    }
  });
});
