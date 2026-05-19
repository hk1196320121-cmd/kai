import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { checkDuplicate } from "../../../src/core/profile/dedup";
import { ProfileEngine } from "../../../src/core/profile/engine";
import { KaiDB } from "../../../src/db/client";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";

describe("checkDuplicate", () => {
  let engine: ProfileEngine;
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-dedup-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    engine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("returns isDuplicate=false for new content", () => {
    const result = checkDuplicate(engine, "mcp:claude-code", "hello world");
    expect(result.isDuplicate).toBe(false);
    expect(result.hash).toHaveLength(16);
  });

  test("returns isDuplicate=true when key already exists", () => {
    const first = checkDuplicate(engine, "mcp:claude-code", "hello world");
    engine.addObservation({
      type: "signal",
      key: `mcp:claude-code:${first.hash}`,
      value: JSON.stringify({ text: "hello world" }),
      confidence: 5,
      source: "mcp",
      provenance: "{}",
    });
    const second = checkDuplicate(engine, "mcp:claude-code", "hello world");
    expect(second.isDuplicate).toBe(true);
    expect(second.hash).toBe(first.hash);
  });

  test("different content produces different hashes", () => {
    const a = checkDuplicate(engine, "mcp:tool", "content A");
    const b = checkDuplicate(engine, "mcp:tool", "content B");
    expect(a.hash).not.toBe(b.hash);
    expect(a.isDuplicate).toBe(false);
    expect(b.isDuplicate).toBe(false);
  });

  test("hash includes context and tags when provided", () => {
    const a = checkDuplicate(engine, "mcp:tool", "same text", { tags: ["a"], context: "ctx1" });
    const b = checkDuplicate(engine, "mcp:tool", "same text", { tags: ["b"], context: "ctx2" });
    expect(a.hash).not.toBe(b.hash);
  });
});
