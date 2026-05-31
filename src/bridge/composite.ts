import type { AgentBridge, DispatchResult } from "./agent-bridge";

export interface CompositeBridgeBridges {
  claude: AgentBridge;
  hermes: AgentBridge;
}

export class CompositeBridge implements AgentBridge {
  private bridges: Map<string, AgentBridge>;

  constructor(mapping: CompositeBridgeBridges) {
    this.bridges = new Map([
      ["claude", mapping.claude],
      ["hermes", mapping.hermes],
    ]);
  }

  async dispatchOneOff(
    taskId: string,
    agent: string,
    prompt: string,
  ): Promise<DispatchResult> {
    const resolved = this.resolveAgent(agent);
    if (!resolved) {
      return {
        success: false,
        agent,
        error: `AGENT_NOT_FOUND: no bridge configured for agent "${agent}"`,
        retryable: false,
      };
    }

    // Pass the RESOLVED agent name to the bridge (not the original "auto")
    const resolvedName = agent === "auto" ? "claude" : agent;
    const result = await resolved.dispatchOneOff(taskId, resolvedName, prompt);

    // auto route falls back to hermes if claude returns AGENT_NOT_FOUND
    if (agent === "auto" && !result.success && result.error?.includes("AGENT_NOT_FOUND")) {
      const hermes = this.bridges.get("hermes");
      if (hermes) {
        return hermes.dispatchOneOff(taskId, "hermes", prompt);
      }
    }

    return result;
  }

  async scheduleCron(
    taskId: string,
    schedule: string,
    prompt: string,
  ): Promise<DispatchResult> {
    const hermes = this.bridges.get("hermes");
    if (!hermes) {
      return {
        success: false,
        agent: "hermes",
        error: "AGENT_NOT_FOUND: hermes bridge not configured",
        retryable: false,
      };
    }
    return hermes.scheduleCron(taskId, schedule, prompt);
  }

  async cancelCron(taskId: string): Promise<boolean> {
    const hermes = this.bridges.get("hermes");
    if (!hermes) return false;
    return hermes.cancelCron(taskId);
  }

  async listPending(): Promise<
    Array<{ id: string; type: string; schedule?: string; prompt: string }>
  > {
    const all: Array<{ id: string; type: string; schedule?: string; prompt: string }> = [];
    for (const bridge of this.bridges.values()) {
      all.push(...await bridge.listPending());
    }
    return all;
  }

  /** Resolve agent name to bridge instance. "auto" defaults to claude in Phase 1. */
  private resolveAgent(agent: string): AgentBridge | null {
    const name = agent === "auto" ? "claude" : agent;
    return this.bridges.get(name) ?? null;
  }
}
