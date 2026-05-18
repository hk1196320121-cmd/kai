import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMcpServer } from "../../src/mcp/server";
import { KaiDB } from "../../src/db/client";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";

describe("createMcpServer", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-mcp-server-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("creates server without error", () => {
    const server = createMcpServer(db);
    expect(server).toBeDefined();
  });

  test("server has correct name and version", () => {
    const server = createMcpServer(db);
    const serverInfo = (server as any).server._serverInfo;
    expect(serverInfo.name).toBe("kai");
    expect(serverInfo.version).toBe("0.1.0");
  });
});
