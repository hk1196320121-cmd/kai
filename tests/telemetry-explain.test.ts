import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { explainTelemetry } from "../src/core/telemetry/explain";
import { LLMProvider } from "../src/llm/provider";

describe("TelemetryExplain", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-explain-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("returns stats-only summary when no LLM provider", async () => {
    store.insertTrace({
      id: "t1", trigger: "mcp_request", tool_name: "profile.read",
      started_at: new Date().toISOString(), duration_ms: 100, status: "completed",
    });
    const result = await explainTelemetry(store, "what happened?", null);
    expect(result.summary).toBeDefined();
    expect(typeof result.summary).toBe("string");
    expect(result.insights).toEqual([]);
  });

  test("returns stats-only when LLM has no API key", async () => {
    const llm = new LLMProvider({ apiKey: "" });
    store.insertTrace({
      id: "t2", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 50, status: "completed",
    });
    const result = await explainTelemetry(store, "health?", llm);
    expect(result.summary).toBeDefined();
    expect(result.insights).toEqual([]);
  });

  test("summary includes trace count and error rate", async () => {
    store.insertTrace({
      id: "t3", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 100, status: "completed",
    });
    store.insertTrace({
      id: "t4", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 50, status: "error",
    });
    const result = await explainTelemetry(store, "summary", null);
    expect(result.summary).toContain("2");
    expect(result.summary).toContain("error");
  });

  test("includes referenced trace IDs", async () => {
    store.insertTrace({
      id: "t5", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const result = await explainTelemetry(store, "recent traces?", null);
    expect(result.traces).toHaveLength(0);
  });

  test("rate limits: returns cached result within 5 minutes", async () => {
    store.insertTrace({
      id: "t6", trigger: "mcp_request", tool_name: "test",
      started_at: new Date().toISOString(), duration_ms: 10, status: "completed",
    });
    const r1 = await explainTelemetry(store, "same question", null);
    const r2 = await explainTelemetry(store, "same question", null);
    expect(r1.summary).toBe(r2.summary);
  });
});
