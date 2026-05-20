// tests/bridge/agent-bridge.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { HermesAgentBridge } from "../../src/bridge/agent-bridge";
import { mkdirSync, rmSync, readdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("HermesAgentBridge", () => {
  let bridge: HermesAgentBridge;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `kai-bridge-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "cron", "pending"), { recursive: true });
    bridge = new HermesAgentBridge(testDir);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true }); } catch {}
  });

  test("dispatchOneOff writes a pending task file", async () => {
    const result = await bridge.dispatchOneOff("task-1", "hermes", "Do something");
    expect(result.success).toBe(true);
    expect(result.agent).toBe("hermes");

    const pending = readdirSync(join(testDir, "cron", "pending"));
    expect(pending.length).toBe(1);
    const content = JSON.parse(readFileSync(join(testDir, "cron", "pending", pending[0]), "utf-8"));
    expect(content.id).toBe("task-1");
    expect(content.prompt).toBe("Do something");
  });

  test("scheduleCron writes a cron job file", async () => {
    const result = await bridge.scheduleCron("task-1", "0 9 * * 1-5", "Daily practice");
    expect(result.success).toBe(true);

    const pending = readdirSync(join(testDir, "cron", "pending"));
    expect(pending.length).toBe(1);
    const content = JSON.parse(readFileSync(join(testDir, "cron", "pending", pending[0]), "utf-8"));
    expect(content.schedule).toBe("0 9 * * 1-5");
    expect(content.type).toBe("cron");
  });

  test("cancelCron removes the cron file", async () => {
    await bridge.scheduleCron("task-1", "0 9 * * *", "Test");
    await bridge.cancelCron("task-1");
    const pending = readdirSync(join(testDir, "cron", "pending"));
    expect(pending.length).toBe(0);
  });

  test("listPending returns all pending jobs", async () => {
    await bridge.dispatchOneOff("task-1", "hermes", "A");
    await bridge.dispatchOneOff("task-2", "hermes", "B");
    const pending = await bridge.listPending();
    expect(pending).toHaveLength(2);
  });
});
