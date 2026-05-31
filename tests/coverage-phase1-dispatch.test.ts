/**
 * Gap-filling tests for Phase 1 agent dispatch (feat/new-one).
 * Covers code paths not exercised by existing test suites.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { CompositeBridge } from "../src/bridge/composite";
import { ClaudeCodeBridge } from "../src/bridge/claude-code";
import type { AgentBridge, DispatchResult } from "../src/bridge/agent-bridge";
import { Scheduler } from "../src/core/orchestrator/scheduler";
import { OrchestratorStore } from "../src/core/orchestrator/store";
import { KaiDB } from "../src/db/client";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOrchestratorHandlers } from "../src/mcp/orchestrator-handlers";
import { WorkspaceStore } from "../src/workspace/store";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class MockBridge implements AgentBridge {
  calls: Array<{ taskId: string; agent: string; prompt: string }> = [];
  private result: DispatchResult;

  constructor(result: DispatchResult) {
    this.result = result;
  }

  async dispatchOneOff(
    taskId: string,
    agent: string,
    prompt: string,
  ): Promise<DispatchResult> {
    this.calls.push({ taskId, agent, prompt });
    return this.result;
  }

  async scheduleCron(
    _taskId: string,
    _schedule: string,
    _prompt: string,
  ): Promise<DispatchResult> {
    return this.result;
  }

  async cancelCron(): Promise<boolean> {
    throw new Error("not implemented");
  }

  async listPending() {
    return [];
  }
}

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// 1. CompositeBridge: openclaw -> hermes routing
// ---------------------------------------------------------------------------

describe("CompositeBridge openclaw routing", () => {
  test("routes 'openclaw' agent to hermes bridge with resolved name", async () => {
    const claudeMock = new MockBridge({ success: true, agent: "claude" });
    const hermesMock = new MockBridge({ success: true, agent: "hermes" });
    const bridge = new CompositeBridge({
      claude: claudeMock,
      hermes: hermesMock,
    });

    const result = await bridge.dispatchOneOff("t1", "openclaw", "Run openclaw");
    expect(result.success).toBe(true);
    // openclaw should route to hermes with resolved name
    expect(hermesMock.calls).toHaveLength(1);
    expect(hermesMock.calls[0].agent).toBe("hermes");
    expect(claudeMock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. CompositeBridge: scheduleCron when hermes missing
// ---------------------------------------------------------------------------

describe("CompositeBridge scheduleCron without hermes", () => {
  test("returns AGENT_NOT_FOUND when hermes bridge is not configured", async () => {
    const claudeMock = new MockBridge({ success: true, agent: "claude" });
    const bridge = new CompositeBridge({
      claude: claudeMock,
      hermes: null as any,
    });
    // Remove hermes from internal map
    (bridge as any).bridges.delete("hermes");

    const result = await bridge.scheduleCron("t1", "0 9 * * *", "Daily");
    expect(result.success).toBe(false);
    expect(result.error).toContain("AGENT_NOT_FOUND");
    expect(result.error).toContain("hermes bridge not configured");
  });
});

// ---------------------------------------------------------------------------
// 3. CompositeBridge: cancelCron when hermes missing
// ---------------------------------------------------------------------------

describe("CompositeBridge cancelCron without hermes", () => {
  test("returns false when hermes bridge is not configured", async () => {
    const claudeMock = new MockBridge({ success: true, agent: "claude" });
    const bridge = new CompositeBridge({
      claude: claudeMock,
      hermes: null as any,
    });
    (bridge as any).bridges.delete("hermes");

    const result = await bridge.cancelCron("t1");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. CompositeBridge: auto does not fallback on non-AGENT_NOT_FOUND errors
// ---------------------------------------------------------------------------

describe("CompositeBridge auto non-fallback", () => {
  test("auto returns error directly when claude fails with non-AGENT_NOT_FOUND", async () => {
    const claudeMock = new MockBridge({
      success: false,
      agent: "claude",
      error: "EXECUTION_FAILED: something broke",
      retryable: false,
    });
    const hermesMock = new MockBridge({ success: true, agent: "hermes" });
    const bridge = new CompositeBridge({
      claude: claudeMock,
      hermes: hermesMock,
    });

    const result = await bridge.dispatchOneOff("t1", "auto", "Try auto");
    expect(result.success).toBe(false);
    expect(result.error).toContain("EXECUTION_FAILED");
    // Hermes should NOT be called - only AGENT_NOT_FOUND triggers fallback
    expect(hermesMock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Scheduler C8: one_off tasks not dispatched during schedule
// ---------------------------------------------------------------------------

describe("Scheduler C8: one_off tasks not dispatched", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-sched-c8-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {}
    }
  });

  test("one_off tasks are marked scheduled without calling bridge.dispatchOneOff", async () => {
    let dispatchOneOffCalls = 0;
    const bridge: AgentBridge = {
      dispatchOneOff: async () => {
        dispatchOneOffCalls++;
        return { success: true, agent: "hermes" };
      },
      scheduleCron: async (taskId, _schedule, _prompt) => ({
        success: true,
        agent: "hermes",
        jobId: taskId,
      }),
      cancelCron: async () => true,
      listPending: async () => [],
    };

    const scheduler = new Scheduler(store, bridge);
    const idea = store.createIdea({
      title: "C8 Test",
      description: "D",
      domain: "general",
      priority: "medium",
      workspace_id: "ws-1",
    });
    store.createTask({
      idea_id: idea.id,
      workspace_id: "ws-1",
      title: "OneOff",
      description: "D",
      type: "one_off",
      agent: "hermes",
      prompt: "P",
      decomposition_rationale: "R",
      scheduling_rationale: "R",
    });

    const result = await scheduler.scheduleTasks(idea.id, []);
    expect(result.scheduled).toBe(1);
    // C8 fix: one_off tasks should NOT trigger bridge.dispatchOneOff
    expect(dispatchOneOffCalls).toBe(0);
    const task = store.getTasksByIdea(idea.id)[0];
    expect(task.status).toBe("scheduled");
  });
});

// ---------------------------------------------------------------------------
// 6. kai_dispatch_feedback: without optional reason
// ---------------------------------------------------------------------------

describe("kai_dispatch_feedback without optional reason", () => {
  let db: KaiDB;
  let dbPath: string;
  let registered: Record<string, any>;
  let savedLlmEnv: {
    apiKey: string | undefined;
    baseUrl: string | undefined;
  };

  beforeEach(() => {
    savedLlmEnv = {
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_BASE_URL,
    };
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;

    dbPath = join(tmpdir(), `kai-fb-noreason-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    const server = new McpServer({ name: "kai-test", version: "0.0.0" });
    registerOrchestratorHandlers(server, db);
    registered = (server as any)._registeredTools;
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {}
    }
    if (savedLlmEnv.apiKey !== undefined)
      process.env.LLM_API_KEY = savedLlmEnv.apiKey;
    if (savedLlmEnv.baseUrl !== undefined)
      process.env.LLM_BASE_URL = savedLlmEnv.baseUrl;
  });

  test("records approved feedback without optional reason", async () => {
    const store = new OrchestratorStore(db);
    const wsStore = new WorkspaceStore(db);
    const ws = wsStore.createWorkspace({ name: "WS" });
    const idea = store.createIdea({
      title: "T",
      description: "D",
      domain: "general",
      priority: "medium",
      workspace_id: ws.id,
    });
    const task = store.createTask({
      idea_id: idea.id,
      workspace_id: ws.id,
      title: "Task",
      description: "D",
      type: "one_off",
      agent: "claude",
      prompt: "P",
      decomposition_rationale: "R",
      scheduling_rationale: "R",
    });

    const dispatchId = randomUUID();
    store.createDispatchDecision({
      id: dispatchId,
      task_id: task.id,
      agent: "claude",
      confidence: 0.8,
      reasoning: "test",
    });

    // Call WITHOUT reason parameter
    const result = await registered["kai_dispatch_feedback"].handler({
      dispatch_id: dispatchId,
      decision: "approved",
    });
    const parsed = parseResult(result);

    expect(parsed.recorded).toBe(true);
    expect(parsed.decision).toBe("approved");

    // Verify DB: user_reason should be null
    const row = store.getDispatchDecision(dispatchId);
    expect(row!.user_decision).toBe("approved");
    expect(row!.user_reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. kai_task_execute: dispatch_id is recorded in dispatch_decisions
// ---------------------------------------------------------------------------

describe("kai_task_execute dispatch_id recording", () => {
  let db: KaiDB;
  let dbPath: string;
  let registered: Record<string, any>;
  let savedLlmEnv: {
    apiKey: string | undefined;
    baseUrl: string | undefined;
  };

  beforeEach(() => {
    savedLlmEnv = {
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_BASE_URL,
    };
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;

    dbPath = join(tmpdir(), `kai-exe-dispid-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    const server = new McpServer({ name: "kai-test", version: "0.0.0" });
    registerOrchestratorHandlers(server, db);
    registered = (server as any)._registeredTools;
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {}
    }
    if (savedLlmEnv.apiKey !== undefined)
      process.env.LLM_API_KEY = savedLlmEnv.apiKey;
    if (savedLlmEnv.baseUrl !== undefined)
      process.env.LLM_BASE_URL = savedLlmEnv.baseUrl;
  });

  test("kai_task_execute records dispatch_id in response and DB", async () => {
    const store = new OrchestratorStore(db);
    const wsStore = new WorkspaceStore(db);
    const ws = wsStore.createWorkspace({ name: "WS" });
    const idea = store.createIdea({
      title: "T",
      description: "D",
      domain: "general",
      priority: "medium",
      workspace_id: ws.id,
    });
    const task = store.createTask({
      idea_id: idea.id,
      workspace_id: ws.id,
      title: "Dispatchable",
      description: "D",
      type: "one_off",
      agent: "hermes",
      prompt: "P",
      decomposition_rationale: "R",
      scheduling_rationale: "R",
    });

    const result = await registered["kai_task_execute"].handler({
      task_id: task.id,
    });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.dispatch_id).toBeDefined();
    expect(typeof parsed.dispatch_id).toBe("string");
    expect(parsed.dispatch_id.length).toBeGreaterThan(0);

    // Verify dispatch decision exists in DB
    const row = store.getDispatchDecision(parsed.dispatch_id);
    expect(row).not.toBeNull();
    expect(row!.task_id).toBe(task.id);
    expect(row!.agent).toBe("hermes");
  });
});

// ---------------------------------------------------------------------------
// 8. ClaudeCodeBridge: readStream OOM cap (output > 1MB)
// ---------------------------------------------------------------------------

describe("ClaudeCodeBridge OOM cap", () => {
  const MOCK_DIR = join(tmpdir(), "kai-claude-oom-test");
  const MOCK_BIN = join(MOCK_DIR, "claude");

  beforeEach(() => {
    mkdirSync(MOCK_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(MOCK_DIR, { recursive: true });
    } catch {}
  });

  function mockClaude(script: string) {
    writeFileSync(MOCK_BIN, `#!/bin/bash\n${script}\n`, { mode: 0o755 });
  }

  test("caps output at 1MB without error", async () => {
    // Generate ~1.5MB of output - should be capped to 1MB
    mockClaude(
      'python3 -c "import sys; sys.stdout.buffer.write(b\'A\' * 1536 * 1024)"',
    );
    const bridge = new ClaudeCodeBridge({
      timeoutMs: 30_000,
      cwd: MOCK_DIR,
      bin: MOCK_BIN,
    });
    const result = await bridge.dispatchOneOff("t1", "claude", "Big output");
    expect(result.success).toBe(true);
    // Output should be capped at MAX_OUTPUT_BYTES (1MB)
    expect(result.output!.length).toBeLessThanOrEqual(1_024 * 1_024 + 100); // allow slack for partial last chunk
    expect(result.output!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 9. ClaudeCodeBridge: non-zero exit with no stderr uses exit code in error
// ---------------------------------------------------------------------------

describe("ClaudeCodeBridge non-zero exit no stderr", () => {
  const MOCK_DIR = join(tmpdir(), "kai-claude-nostderr-test");
  const MOCK_BIN = join(MOCK_DIR, "claude");

  beforeEach(() => {
    mkdirSync(MOCK_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(MOCK_DIR, { recursive: true });
    } catch {}
  });

  function mockClaude(script: string) {
    writeFileSync(MOCK_BIN, `#!/bin/bash\n${script}\n`, { mode: 0o755 });
  }

  test("returns exit code in error when no stderr is produced", async () => {
    // Exit with code 42 and produce no stderr
    mockClaude("exit 42");
    const bridge = new ClaudeCodeBridge({
      timeoutMs: 5_000,
      cwd: MOCK_DIR,
      bin: MOCK_BIN,
    });
    const result = await bridge.dispatchOneOff("t1", "claude", "Fail silently");
    expect(result.success).toBe(false);
    // When stderr is empty, error should contain "exited with code 42"
    expect(result.error).toContain("exited with code 42");
    expect(result.retryable).toBe(false);
  });
});
