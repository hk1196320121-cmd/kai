import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMcpServer } from "../../src/mcp/server";
import { ProfileEngine } from "../../src/core/profile/engine";
import { KaiDB } from "../../src/db/client";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";

describe("MCP Resources", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-mcp-res-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Test", role: "Developer" });
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  async function listResources() {
    const server = createMcpServer(db);
    const inner = (server as any).server;
    const handler = inner._requestHandlers.get("resources/list");
    const result = await handler({ method: "resources/list", params: {} });
    return result;
  }

  async function readResource(uri: string) {
    const server = createMcpServer(db);
    const inner = (server as any).server;
    const handler = inner._requestHandlers.get("resources/read");
    const result = await handler({
      method: "resources/read",
      params: { uri },
    });
    return result;
  }

  async function listResourceTemplates() {
    const server = createMcpServer(db);
    const inner = (server as any).server;
    const handler = inner._requestHandlers.get("resources/templates/list");
    const result = await handler({ method: "resources/templates/list", params: {} });
    return result;
  }

  test("all static resources are registered", async () => {
    const result = await listResources();
    const uris = result.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain("kai://profile/identity");
    expect(uris).toContain("kai://profile/traits");
    expect(uris).toContain("kai://profile/observations/recent");
    expect(uris).toContain("kai://profile/summary");
    expect(uris).toContain("kai://system/health");
  });

  test("traits/{dimension} template is registered", async () => {
    const result = await listResourceTemplates();
    const templates = result.resourceTemplates.map((t: { uriTemplate: string }) => t.uriTemplate);
    expect(templates).toContain("kai://profile/traits/{dimension}");
  });

  test("kai://profile/identity returns identity fields", async () => {
    const result = await readResource("kai://profile/identity");
    expect(result.contents).toHaveLength(1);
    const data = JSON.parse(result.contents[0].text);
    expect(data.name).toBe("Test");
    expect(data.role).toBe("Developer");
    expect(data).toHaveProperty("goals");
    expect(data).toHaveProperty("expertise_areas");
    expect(data).toHaveProperty("learning_interests");
  });

  test("kai://profile/traits returns all traits with 0-1 confidence", async () => {
    const engine = new ProfileEngine(db);
    engine.setTrait({
      dimension: "risk_tolerance",
      value: 0.7,
      confidence: 8,
      source: "declared",
      reasoning: "test",
    });

    const result = await readResource("kai://profile/traits");
    const data = JSON.parse(result.contents[0].text);
    expect(data.traits).toHaveLength(1);
    expect(data.traits[0].dimension).toBe("risk_tolerance");
    expect(data.traits[0].value).toBe(0.7);
    // confidence should be converted to 0-1 scale: (8-1)/9 = 0.777...
    expect(data.traits[0].confidence).toBeCloseTo(7 / 9, 5);
    expect(data.traits[0].confidence).toBeGreaterThanOrEqual(0);
    expect(data.traits[0].confidence).toBeLessThanOrEqual(1);
  });

  test("kai://profile/traits/{dimension} returns single trait", async () => {
    const engine = new ProfileEngine(db);
    engine.setTrait({
      dimension: "risk_tolerance",
      value: 0.7,
      confidence: 8,
      source: "declared",
      reasoning: "test",
    });
    engine.setTrait({
      dimension: "autonomy",
      value: 0.5,
      confidence: 5,
      source: "observed",
      reasoning: "test auto",
    });

    const result = await readResource("kai://profile/traits/risk_tolerance");
    const data = JSON.parse(result.contents[0].text);
    expect(data.traits).toHaveLength(1);
    expect(data.traits[0].dimension).toBe("risk_tolerance");
  });

  test("kai://profile/traits/{dimension} returns empty for unknown dimension", async () => {
    const result = await readResource("kai://profile/traits/nonexistent");
    const data = JSON.parse(result.contents[0].text);
    expect(data.traits).toEqual([]);
  });

  test("kai://profile/observations/recent returns last 50 observations", async () => {
    const engine = new ProfileEngine(db);
    // Add 3 observations
    for (let i = 0; i < 3; i++) {
      engine.addObservation({
        type: "behavior",
        key: `test-key-${i}`,
        value: JSON.stringify({ action: `action-${i}`, tags: [`tag-${i}`] }),
        confidence: 5,
        source: "session_log",
        provenance: "{}",
      });
    }

    const result = await readResource("kai://profile/observations/recent");
    const data = JSON.parse(result.contents[0].text);
    expect(data).toHaveLength(3);
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("text");
    expect(data[0]).toHaveProperty("source");
    expect(data[0]).toHaveProperty("timestamp");
  });

  test("kai://profile/summary returns identity, top traits, and obs count", async () => {
    const engine = new ProfileEngine(db);
    engine.setTrait({
      dimension: "risk_tolerance",
      value: 0.7,
      confidence: 9,
      source: "declared",
      reasoning: "high",
    });
    engine.setTrait({
      dimension: "autonomy",
      value: 0.5,
      confidence: 5,
      source: "observed",
      reasoning: "mid",
    });
    engine.addObservation({
      type: "behavior",
      key: "test",
      value: "{}",
      confidence: 5,
      source: "session_log",
      provenance: "{}",
    });

    const result = await readResource("kai://profile/summary");
    const data = JSON.parse(result.contents[0].text);
    expect(data.identity).toBeDefined();
    expect(data.identity.name).toBe("Test");
    expect(data.topTraits).toBeDefined();
    expect(data.topTraits).toHaveLength(2);
    // Higher confidence trait should be first
    expect(data.topTraits[0].confidence).toBeGreaterThanOrEqual(data.topTraits[1].confidence);
    expect(data.observationCount).toBe(1);
  });

  test("kai://system/health returns db integrity and stats", async () => {
    const engine = new ProfileEngine(db);
    engine.addObservation({
      type: "behavior",
      key: "test",
      value: "{}",
      confidence: 5,
      source: "cron_output",
      provenance: "{}",
    });

    const result = await readResource("kai://system/health");
    const data = JSON.parse(result.contents[0].text);
    expect(data.status).toBe("ok");
    expect(data.db.integrity).toBe("ok");
    expect(data.db.sizeBytes).toBeGreaterThan(0);
    expect(data.stats.observationCount).toBeGreaterThanOrEqual(1);
    expect(data.stats.traitCount).toBeGreaterThanOrEqual(0);
    expect(data.stats.lastObservationAt).toBeTruthy();
    expect(data.stats.lastCollectionAt).toBeTruthy();
  });
});
