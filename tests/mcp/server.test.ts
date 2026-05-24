import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMcpServer } from "../../src/mcp/server";
import { KaiDB } from "../../src/db/client";
import { join } from "path";
import { tmpdir } from "os";
import { readFileSync, unlinkSync } from "fs";

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
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
    );
    expect(serverInfo.name).toBe("kai");
    expect(serverInfo.version).toBe(pkg.version);
  });
});
