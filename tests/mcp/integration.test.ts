import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ProfileEngine } from "../../src/core/profile/engine";
import { KaiDB } from "../../src/db/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";

const CLI_PATH = join(import.meta.dir, "../../src/cli/index.ts");

describe("MCP Integration", () => {
  let db: KaiDB;
  let dbPath: string;
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-mcp-integ-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Integration", role: "Tester" });
    db.close(); // Close so the subprocess can open it
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.close();
      } catch {
        // ignore close errors
      }
      client = null;
    }
    transport = null;
    // Clean up temp DB files
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {
        // ignore
      }
    }
  });

  async function connectClient(): Promise<Client> {
    const t = new StdioClientTransport({
      command: "bun",
      args: ["run", CLI_PATH, "mcp", "serve", "--db", dbPath],
    });
    transport = t;
    const c = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} },
    );
    await c.connect(t);
    client = c;
    return c;
  }

  test("full round-trip: read profile, submit observation, derive, read again", async () => {
    const c = await connectClient();

    // Step 1: Read identity
    const readResult = await c.callTool({
      name: "profile.read",
      arguments: { scope: "identity" },
    });
    const readContent = readResult.content as { type: string; text: string }[];
    const readData = JSON.parse(readContent[0].text);
    expect(readData.identity.name).toBe("Integration");
    expect(readData.identity.role).toBe("Tester");

    // Step 2: Submit observation
    const submitResult = await c.callTool({
      name: "observe.submit",
      arguments: {
        text: "User prefers detailed explanations when learning new concepts",
        sourceTool: "integration-test",
        confidence: 0.8,
        tags: ["learning", "preference"],
      },
    });
    const submitContent = submitResult.content as {
      type: string;
      text: string;
    }[];
    const submitData = JSON.parse(submitContent[0].text);
    expect(submitData.source).toBe("mcp");
    expect(submitData.dedupHash).toBeDefined();
    expect(submitData.id).toBeDefined();

    // Step 3: Derive traits
    const deriveResult = await c.callTool({
      name: "derive.trigger",
      arguments: { method: "rules" },
    });
    const deriveContent = deriveResult.content as {
      type: string;
      text: string;
    }[];
    const deriveData = JSON.parse(deriveContent[0].text);
    expect(typeof deriveData.derived).toBe("number");

    // Step 4: Read traits
    const traitsResult = await c.callTool({
      name: "profile.read",
      arguments: { scope: "traits" },
    });
    const traitsContent = traitsResult.content as {
      type: string;
      text: string;
    }[];
    const traitsData = JSON.parse(traitsContent[0].text);
    expect(Array.isArray(traitsData.traits)).toBe(true);

    // Step 5: List resources — static resources plus templates
    const resourceList = await c.listResources();
    expect(resourceList.resources.length).toBeGreaterThanOrEqual(5);
  });

  test("observe.submit dedup returns duplicate:true on second call", async () => {
    const c = await connectClient();

    const args = {
      text: "Duplicate observation test",
      sourceTool: "test",
    };
    const first = await c.callTool({
      name: "observe.submit",
      arguments: args,
    });
    const firstData = JSON.parse(
      (first.content as { text: string }[])[0].text,
    );
    expect(firstData.duplicate).toBeFalsy();

    const second = await c.callTool({
      name: "observe.submit",
      arguments: args,
    });
    const secondData = JSON.parse(
      (second.content as { text: string }[])[0].text,
    );
    expect(secondData.duplicate).toBe(true);
  });

  test("observe.batch processes multiple observations", async () => {
    const c = await connectClient();

    const result = await c.callTool({
      name: "observe.batch",
      arguments: {
        sourceTool: "batch-test",
        observations: [
          { text: "First observation", confidence: 0.7 },
          { text: "Second observation", tags: ["test"] },
          { text: "Third observation", context: "integration test" },
        ],
      },
    });
    const data = JSON.parse(
      (result.content as { text: string }[])[0].text,
    );
    expect(data.submitted).toBe(3);
    expect(data.results.length).toBe(3);
    expect(data.errors).toBe(0);
  });
});
