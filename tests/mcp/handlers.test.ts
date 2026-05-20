import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMcpServer } from "../../src/mcp/server";
import { KaiDB } from "../../src/db/client";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";

describe("MCP Tools", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-mcp-tools-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {}
    }
  });

  test("all tools are registered", () => {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    const names = Object.keys(registered);
    expect(names).toContain("profile.read");
    expect(names).toContain("profile.why");
    expect(names).toContain("observe.submit");
    expect(names).toContain("derive.trigger");
    expect(names).toContain("observe.batch");
    // Orchestrator tools
    expect(names).toContain("kai_idea_submit");
    expect(names).toContain("kai_idea_plan");
    expect(names).toContain("kai_plan_approve");
    expect(names).toContain("kai_task_execute");
    expect(names).toContain("kai_idea_pause");
    expect(names).toContain("kai_execution_status");
    expect(names).toContain("kai_replan");
    expect(names.length).toBe(12);
  });

  test("each tool has a handler function", () => {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    for (const name of Object.keys(registered)) {
      const tool = registered[name];
      expect(typeof tool.handler).toBe("function");
    }
  });

  test("profile.read returns identity=null when no identity", async () => {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    const result = await registered["profile.read"].handler({ scope: "summary" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.identity).toBeNull();
    expect(parsed.topTraits).toEqual([]);
    expect(parsed.observationCount).toBe(0);
  });

  test("observe.submit stores an observation", async () => {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    const result = await registered["observe.submit"].handler({
      text: "Test observation from handler test",
      sourceTool: "bun-test",
      confidence: 0.8,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBeDefined();
    expect(parsed.text).toBe("Test observation from handler test");
    expect(parsed.source).toBe("mcp");
    expect(parsed.dedupHash).toBeDefined();
  });

  test("observe.submit deduplicates identical observations", async () => {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    await registered["observe.submit"].handler({
      text: "Duplicate test",
      sourceTool: "bun-test",
    });
    const result = await registered["observe.submit"].handler({
      text: "Duplicate test",
      sourceTool: "bun-test",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.duplicate).toBe(true);
  });

  test("observe.batch handles multiple observations", async () => {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    const result = await registered["observe.batch"].handler({
      sourceTool: "bun-test",
      observations: [
        { text: "First observation" },
        { text: "Second observation" },
        { text: "Third observation" },
      ],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.submitted).toBe(3);
    expect(parsed.duplicates).toBe(0);
    expect(parsed.errors).toBe(0);
    expect(parsed.results.length).toBe(3);
  });

  test("derive.trigger with rules returns empty when no observations", async () => {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    const result = await registered["derive.trigger"].handler({ method: "rules" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.derived).toBe(0);
    expect(parsed.traits).toEqual([]);
  });

  test("profile.why returns error for unknown dimension", async () => {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    const result = await registered["profile.why"].handler({
      dimension: "nonexistent_trait",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("trait_not_found");
    expect(parsed.dimension).toBe("nonexistent_trait");
  });
});
