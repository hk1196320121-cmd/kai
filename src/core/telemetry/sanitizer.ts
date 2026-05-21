const SENSITIVE_PATTERN = /(api.?key|token|secret|password|credential)/i;

export function sanitize<T extends Record<string, unknown>>(
  obj: T,
): Record<string, unknown> {
  return sanitizeRecursive(obj) as Record<string, unknown>;
}

function sanitizeRecursive(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeRecursive);

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_PATTERN.test(key) && val !== null && val !== undefined) {
      result[key] = "[REDACTED]";
    } else if (SENSITIVE_PATTERN.test(key)) {
      result[key] = val;
    } else {
      result[key] = sanitizeRecursive(val);
    }
  }
  return result;
}
