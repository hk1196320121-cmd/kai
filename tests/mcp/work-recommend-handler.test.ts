import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMcpServer } from "../../src/mcp/server";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";

describe("kai_work_recommend MCP tool", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-work-recommend-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("tool is registered", () => {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    expect(Object.keys(registered)).toContain("kai_work_recommend");
  });

  test("returns recommendations based on current profile", async () => {
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Test", role: "engineer" });
    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: ["engineering"] }),
      confidence: 7,
      source: "coldstart",
      provenance: "{}",
    });
    engine.addObservation({
      type: "signal",
      key: "coldstart:planning_style",
      value: JSON.stringify({ answer: "detailed plan" }),
      confidence: 8,
      source: "coldstart",
      provenance: "{}",
    });

    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    const result = await registered["kai_work_recommend"].handler({
      domain: "coding",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.recommendations).toBeDefined();
    expect(parsed.recommendations.length).toBe(3);
    expect(parsed.recommendations[0].score).toBeGreaterThan(0);
  });
});
