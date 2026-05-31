import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HermesAgentBridge } from "../bridge/agent-bridge";
import { ClaudeCodeBridge } from "../bridge/claude-code";
import { CompositeBridge } from "../bridge/composite";
import { ClosedLoopEngine } from "../core/orchestrator/closed-loop";
import { OrchestratorStore } from "../core/orchestrator/store";
import { ProfileEngine } from "../core/profile/engine";
import { GeneStore } from "../core/prompt/gene-store";
import { PromptCompiler } from "../core/prompt/prompt-compiler";
import type { TelemetryRecorder } from "../core/telemetry/recorder";
import type { KaiDB } from "../db/client";
import { LLMProvider } from "../llm/provider";
import { WorkspaceStore } from "../workspace/store";
import { registerIdeaHandlers } from "./orchestrator/ideas";
import { registerPlanningHandlers } from "./orchestrator/planning";
import { registerTaskHandlers } from "./orchestrator/tasks";

export function registerOrchestratorHandlers(
  server: McpServer,
  db: KaiDB,
  telemetry: TelemetryRecorder | null = null,
): void {
  const profileEngine = new ProfileEngine(db);
  const store = new OrchestratorStore(db);
  const workspaceStore = new WorkspaceStore(db);
  const llmProvider = new LLMProvider();
  const claudeBridge = new ClaudeCodeBridge({ cwd: process.cwd() });
  const hermesBridge = new HermesAgentBridge();
  const bridge = new CompositeBridge({
    claude: claudeBridge,
    hermes: hermesBridge,
  });
  const _closedLoopEngine = new ClosedLoopEngine(profileEngine, store);
  const geneStore = new GeneStore(db);
  const promptCompiler = new PromptCompiler(geneStore);

  registerIdeaHandlers(server, {
    store,
    workspaceStore,
    profileEngine,
    llmProvider,
    bridge,
    promptCompiler,
    telemetry,
  });

  registerTaskHandlers(server, {
    store,
    profileEngine,
    bridge,
    telemetry,
  });

  registerPlanningHandlers(server, {
    store,
    profileEngine,
    telemetry,
  });
}
