import { describe, test, expect } from "bun:test";
import { CompositeBridge } from "../../src/bridge/composite";
import type { AgentBridge, DispatchResult } from "../../src/bridge/agent-bridge";

/** Mock bridge that records calls and returns configurable results */
class MockBridge implements AgentBridge {
  calls: Array<{ taskId: string; agent: string; prompt: string }> = [];
  private result: DispatchResult;

  constructor(result: DispatchResult) {
    this.result = result;
  }

  async dispatchOneOff(taskId: string, agent: string, prompt: string): Promise<DispatchResult> {
    this.calls.push({ taskId, agent, prompt });
    return this.result;
  }

  async scheduleCron(_taskId: string, _schedule: string, _prompt: string): Promise<DispatchResult> { return this.result; }
  async cancelCron(): Promise<boolean> { throw new Error("not implemented"); }
  async listPending() { return []; }
}

describe("CompositeBridge", () => {
  test("routes 'claude' agent to claude bridge with resolved name", async () => {
    const claudeMock = new MockBridge({ success: true, agent: "claude" });
    const hermesMock = new MockBridge({ success: true, agent: "hermes" });
    const bridge = new CompositeBridge({ claude: claudeMock, hermes: hermesMock });

    const result = await bridge.dispatchOneOff("t1", "claude", "Write code");
    expect(result.success).toBe(true);
    expect(claudeMock.calls).toHaveLength(1);
    expect(claudeMock.calls[0].agent).toBe("claude"); // resolved name, not original
    expect(hermesMock.calls).toHaveLength(0);
  });

  test("routes 'hermes' agent to hermes bridge", async () => {
    const claudeMock = new MockBridge({ success: true, agent: "claude" });
    const hermesMock = new MockBridge({ success: true, agent: "hermes" });
    const bridge = new CompositeBridge({ claude: claudeMock, hermes: hermesMock });

    const result = await bridge.dispatchOneOff("t1", "hermes", "Schedule cron");
    expect(result.success).toBe(true);
    expect(hermesMock.calls).toHaveLength(1);
    expect(claudeMock.calls).toHaveLength(0);
  });

  test("routes 'auto' to claude with resolved name 'claude'", async () => {
    const claudeMock = new MockBridge({ success: true, agent: "claude" });
    const hermesMock = new MockBridge({ success: true, agent: "hermes" });
    const bridge = new CompositeBridge({ claude: claudeMock, hermes: hermesMock });

    const result = await bridge.dispatchOneOff("t1", "auto", "Any task");
    expect(result.success).toBe(true);
    expect(claudeMock.calls).toHaveLength(1);
    expect(claudeMock.calls[0].agent).toBe("claude"); // resolved from "auto"
    expect(hermesMock.calls).toHaveLength(0);
  });

  test("auto falls back to hermes when claude returns AGENT_NOT_FOUND", async () => {
    const claudeMock = new MockBridge({
      success: false, agent: "claude",
      error: "AGENT_NOT_FOUND: claude binary not found in PATH", retryable: false,
    });
    const hermesMock = new MockBridge({ success: true, agent: "hermes" });
    const bridge = new CompositeBridge({ claude: claudeMock, hermes: hermesMock });

    const result = await bridge.dispatchOneOff("t1", "auto", "Fallback task");
    expect(result.success).toBe(true);
    expect(claudeMock.calls).toHaveLength(1);
    expect(hermesMock.calls).toHaveLength(1);
    expect(hermesMock.calls[0].agent).toBe("hermes");
  });

  test("returns AGENT_NOT_FOUND for unknown agent", async () => {
    const claudeMock = new MockBridge({ success: true, agent: "claude" });
    const hermesMock = new MockBridge({ success: true, agent: "hermes" });
    const bridge = new CompositeBridge({ claude: claudeMock, hermes: hermesMock });

    const result = await bridge.dispatchOneOff("t1", "unknown-agent", "Do something");
    expect(result.success).toBe(false);
    expect(result.error).toContain("AGENT_NOT_FOUND");
    expect(result.retryable).toBe(false);
  });

  test("scheduleCron routes to hermes bridge", async () => {
    const claudeMock = new MockBridge({ success: true, agent: "claude" });
    const hermesMock = new MockBridge({ success: true, agent: "hermes", jobId: "j1" });
    const bridge = new CompositeBridge({ claude: claudeMock, hermes: hermesMock });

    const result = await bridge.scheduleCron("t1", "0 9 * * *", "Daily");
    expect(result.success).toBe(true);
  });

  test("listPending aggregates from all bridges", async () => {
    const claudeItem = { id: "c1", type: "one_off", prompt: "claude task" };
    const hermesItem = { id: "h1", type: "cron", schedule: "0 9 * * *", prompt: "hermes task" };

    class ClaudeMockBridge extends MockBridge {
      override async listPending() { return [claudeItem]; }
    }
    class HermesMockBridge extends MockBridge {
      override async listPending() { return [hermesItem]; }
    }

    const claudeMock = new ClaudeMockBridge({ success: true, agent: "claude" });
    const hermesMock = new HermesMockBridge({ success: true, agent: "hermes" });
    const bridge = new CompositeBridge({ claude: claudeMock, hermes: hermesMock });

    const result = await bridge.listPending();
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(claudeItem);
    expect(result).toContainEqual(hermesItem);
  });

  test("cancelCron returns true for hermes bridge", async () => {
    class CancelMockBridge extends MockBridge {
      override async cancelCron() { return true; }
    }

    const claudeMock = new CancelMockBridge({ success: true, agent: "claude" });
    const hermesMock = new CancelMockBridge({ success: true, agent: "hermes" });
    const bridge = new CompositeBridge({ claude: claudeMock, hermes: hermesMock });

    const result = await bridge.cancelCron("t1");
    expect(result).toBe(true);
  });
});
