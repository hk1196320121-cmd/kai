export function safeJsonParse(str: string, fallback: unknown = []): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export const log = (msg: string, data?: unknown): void => {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      msg,
      ...(data ? { data } : {}),
    })}\n`,
  );
};

export function textContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

// biome-ignore lint/suspicious/noExplicitAny: generic handler wrapper needs any for SDK type compatibility
type ToolHandler = (...args: any[]) => Promise<any>;

export function withTrace<T extends ToolHandler>(
  toolName: string,
  handler: T,
  telemetry: import("../core/telemetry/recorder").TelemetryRecorder | null,
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
