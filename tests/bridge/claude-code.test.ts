import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ClaudeCodeBridge } from "../../src/bridge/claude-code";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Tests use a mock shell script instead of the real claude CLI.
 * The script reads prompt from stdin and writes to stdout.
 * Uses absolute path to mock binary (via bin config) to avoid PATH resolution issues.
 */
const MOCK_DIR = join(tmpdir(), "kai-claude-mock-test");
const MOCK_BIN = join(MOCK_DIR, "claude");

describe("ClaudeCodeBridge", () => {
  beforeEach(() => {
    mkdirSync(MOCK_DIR, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(MOCK_DIR, { recursive: true }); } catch {}
  });

  function mockClaude(script: string) {
    writeFileSync(MOCK_BIN, `#!/bin/bash\n${script}\n`, { mode: 0o755 });
  }

  test("dispatchOneOff returns success on exit code 0 with output", async () => {
    mockClaude('cat\necho -n "Hello from Claude"');
    const bridge = new ClaudeCodeBridge({ cwd: MOCK_DIR, bin: MOCK_BIN });
    const result = await bridge.dispatchOneOff("task-1", "claude", "Say hello");
    expect(result.success).toBe(true);
    expect(result.agent).toBe("claude");
    expect(result.retryable).toBe(false);
    expect(result.output).toContain("Hello from Claude");
  });

  test("dispatchOneOff returns failure on non-zero exit with stderr", async () => {
    mockClaude('echo "something went wrong" >&2\nexit 1');
    const bridge = new ClaudeCodeBridge({ cwd: MOCK_DIR, bin: MOCK_BIN });
    const result = await bridge.dispatchOneOff("task-1", "claude", "Do something");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.retryable).toBe(false);
    expect(result.output).toBeUndefined();
  });

  test("dispatchOneOff returns TIMEOUT on timeout", async () => {
    mockClaude("sleep 10\nexit 0");
    const bridge = new ClaudeCodeBridge({ timeoutMs: 50, cwd: MOCK_DIR, bin: MOCK_BIN });
    const result = await bridge.dispatchOneOff("task-1", "claude", "Sleep forever");
    expect(result.success).toBe(false);
    expect(result.error).toContain("TIMEOUT");
    expect(result.retryable).toBe(false);
  });

  test("dispatchOneOff returns AGENT_NOT_FOUND when claude not in PATH", async () => {
    const bridge = new ClaudeCodeBridge({ bin: "/nonexistent/path/claude" });
    const result = await bridge.dispatchOneOff("task-1", "claude", "Hello");
    expect(result.success).toBe(false);
    expect(result.error).toContain("AGENT_NOT_FOUND");
  });

  test("dispatchOneOff rejects empty prompt", async () => {
    const bridge = new ClaudeCodeBridge();
    const result = await bridge.dispatchOneOff("task-1", "claude", "");
    expect(result.success).toBe(false);
    expect(result.error).toContain("empty");
  });

  test("dispatchOneOff rejects prompts exceeding max length", async () => {
    const bridge = new ClaudeCodeBridge();
    const longPrompt = "x".repeat(10_001);
    const result = await bridge.dispatchOneOff("task-1", "claude", longPrompt);
    expect(result.success).toBe(false);
    expect(result.error).toContain("maximum length");
  });

  test("scheduleCron throws not-supported", async () => {
    const bridge = new ClaudeCodeBridge();
    expect(
      bridge.scheduleCron("task-1", "0 9 * * *", "daily"),
    ).rejects.toThrow("not supported");
  });

  test("cancelCron throws not-supported", async () => {
    const bridge = new ClaudeCodeBridge();
    expect(
      bridge.cancelCron("task-1"),
    ).rejects.toThrow("not supported");
  });

  test("listPending returns empty array", async () => {
    const bridge = new ClaudeCodeBridge();
    const pending = await bridge.listPending();
    expect(pending).toEqual([]);
  });
});
