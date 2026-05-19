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
