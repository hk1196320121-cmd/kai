import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaiDB } from "../src/db/client";
import { TelemetryStore } from "../src/core/telemetry/store";
import { TelemetryRecorder } from "../src/core/telemetry/recorder";

// Re-extract withTrace inline since it's not exported from handlers.ts
function withTrace<T extends (...args: any[]) => Promise<any>>(
  toolName: string,
  handler: T,
  telemetry: TelemetryRecorder | null,
): T {
  if (!telemetry) return handler;
  const wrapped = async (args: unknown) => {
    const trace = telemetry.startTrace("mcp_request", toolName);
    const span = trace.startSpan("mcp_tool", toolName);
    try {
      const result = await handler(args);
      span.end("ok");
      trace.end("completed");
      return result;
    } catch (err) {
      span.error(err as Error);
      span.end("error");
      trace.end("error");
      throw err;
    }
  };
  return wrapped as T;
}

describe("withTrace wrapper", () => {
  let db: KaiDB;
  let store: TelemetryStore;
  let recorder: TelemetryRecorder;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-wt-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new TelemetryStore(db);
    recorder = new TelemetryRecorder(store);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("success path: span.end(ok) and trace.end(completed)", async () => {
    const handler = withTrace(
      "profile.read",
      async (_args: unknown) => ({ content: [{ type: "text", text: "ok" }] }),
      recorder,
    );
    await handler({ scope: "summary" });

    const traces = store.queryTelemetry(
      "SELECT * FROM runtime_traces WHERE tool_name = 'profile.read'",
    );
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("completed");

    const spans = store.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'mcp_tool'",
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("ok");
  });

  test("error path: span.error + span.end(error) + trace.end(error) + rethrow", async () => {
    const handler = withTrace(
      "observe.submit",
      async (_args: unknown) => {
        throw new Error("handler boom");
      },
      recorder,
    );

    expect(handler({ text: "x" })).rejects.toThrow("handler boom");

    // Allow microtask queue to flush
    await new Promise((r) => setTimeout(r, 10));

    const traces = store.queryTelemetry(
      "SELECT * FROM runtime_traces WHERE tool_name = 'observe.submit'",
    );
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("error");

    const spans = store.queryTelemetry(
      "SELECT * FROM runtime_spans WHERE operation = 'mcp_tool'",
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("error");

    const errors = store.queryTelemetry(
      "SELECT * FROM runtime_errors WHERE error_type = 'Error'",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("handler boom");
  });

  test("when telemetry is null: handler called directly (passthrough)", async () => {
    let called = false;
    const handler = withTrace(
      "profile.read",
      async (_args: unknown) => {
        called = true;
        return { ok: true };
      },
      null,
    );

    const result = await handler({});
    expect(called).toBe(true);
    expect(result).toEqual({ ok: true });

    // No telemetry should have been recorded
    const traces = store.queryTelemetry("SELECT * FROM runtime_traces");
    expect(traces).toHaveLength(0);
  });
});
