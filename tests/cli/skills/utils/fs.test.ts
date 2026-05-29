import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteJson, atomicWriteYaml } from "../../../../src/cli/skills/utils/fs";

describe("atomicWriteJson", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-fs-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes JSON file with correct content", () => {
    const filePath = join(tempDir, "test.json");
    const data = { name: "kai", version: "0.11.0" };

    atomicWriteJson(filePath, data);

    expect(existsSync(filePath)).toBe(true);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.name).toBe("kai");
    expect(content.version).toBe("0.11.0");
  });

  test("creates parent directories", () => {
    const filePath = join(tempDir, "nested", "dir", "test.json");
    atomicWriteJson(filePath, { ok: true });
    expect(existsSync(filePath)).toBe(true);
  });

  test("overwrites existing file atomically", () => {
    const filePath = join(tempDir, "test.json");
    atomicWriteJson(filePath, { v: 1 });
    atomicWriteJson(filePath, { v: 2 });
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.v).toBe(2);
  });

  test("formats with 2-space indent", () => {
    const filePath = join(tempDir, "test.json");
    atomicWriteJson(filePath, { key: "value" });
    const raw = readFileSync(filePath, "utf-8");
    expect(raw).toContain('  "key"');
  });
});

describe("atomicWriteYaml", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kai-fs-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes YAML file with correct content", () => {
    const filePath = join(tempDir, "test.yaml");
    const data = { mcp_servers: { kai: { command: "kai", args: ["mcp", "serve"] } } };

    atomicWriteYaml(filePath, data);

    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, "utf-8");
    expect(raw).toContain("mcp_servers");
    expect(raw).toContain("command: kai");
  });

  test("creates parent directories", () => {
    const filePath = join(tempDir, "nested", "config.yaml");
    atomicWriteYaml(filePath, { key: "value" });
    expect(existsSync(filePath)).toBe(true);
  });

  test("preserves existing keys when overwriting", () => {
    const filePath = join(tempDir, "test.yaml");
    atomicWriteYaml(filePath, { mcp_servers: { kai: { command: "kai" } } });
    atomicWriteYaml(filePath, { mcp_servers: { kai: { command: "kai" }, other: { command: "other" } } });
    const raw = readFileSync(filePath, "utf-8");
    expect(raw).toContain("other");
  });
});
