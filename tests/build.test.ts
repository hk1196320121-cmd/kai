import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");

describe("build artifacts", () => {
  test("dist/cli/index.js exists with bun shebang", () => {
    const cliPath = join(ROOT, "dist", "cli", "index.js");
    expect(existsSync(cliPath)).toBe(true);
    const content = readFileSync(cliPath, "utf-8");
    expect(content.startsWith("#!/usr/bin/env bun")).toBe(true);
  });

  test("dist/mcp/server.js exists", () => {
    expect(existsSync(join(ROOT, "dist", "mcp", "server.js"))).toBe(true);
  });

  test("dist/mcp/server.d.ts declaration file exists", () => {
    expect(existsSync(join(ROOT, "dist", "mcp", "server.d.ts"))).toBe(true);
  });

  test("compiled CLI outputs correct version", () => {
    const result = spawnSync("bun", ["run", "dist/cli/index.js", "--version"], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    const version = result.stdout.trim();
    // Must be a valid semver (3-part or 4-part)
    expect(version).toMatch(/^\d+\.\d+\.\d+(\.\d+)?$/);
    // Must match package.json version
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf-8"),
    );
    expect(version).toBe(pkg.version);
  });

  test("dist/ preserves extensionless imports", () => {
    const serverPath = join(ROOT, "dist", "mcp", "server.js");
    const content = readFileSync(serverPath, "utf-8");
    // tsc with moduleResolution "bundler" preserves bare specifiers like "./handlers"
    expect(content).toContain('from "./handlers"');
  });
});

describe("npm pack whitelist", () => {
  test("npm pack --dry-run includes only whitelisted files", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    const files: string[] = output[0].files.map(
      (f: { path: string }) => f.path,
    );

    // Must include compiled output
    expect(files.some((f) => f.startsWith("dist/"))).toBe(true);
    // Must include metadata
    expect(files).toContain("README.md");
    expect(files).toContain("CHANGELOG.md");
    // Must include package.json (always included by npm)
    expect(files).toContain("package.json");

    // Must NOT include source files
    expect(files.some((f) => f.startsWith("src/"))).toBe(false);
    // Must NOT include tests
    expect(files.some((f) => f.startsWith("tests/") || f.includes("/test"))).toBe(false);
    // Must NOT include docs
    expect(files.some((f) => f.startsWith("docs/"))).toBe(false);
    // Must NOT include CI configs
    expect(files.some((f) => f.startsWith(".github/"))).toBe(false);
  });
});
