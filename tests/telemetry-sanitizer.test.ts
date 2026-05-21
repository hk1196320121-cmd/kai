import { describe, expect, test } from "bun:test";
import { sanitize } from "../src/core/telemetry/sanitizer";

describe("Sanitizer", () => {
  test("redacts api_key at top level", () => {
    const input = { api_key: "sk-12345", name: "test" };
    const result = sanitize(input);
    expect(result.api_key).toBe("[REDACTED]");
    expect(result.name).toBe("test");
  });

  test("redacts token in nested object", () => {
    const input = { config: { token: "abc123", port: 3000 } };
    const result = sanitize(input);
    expect(result.config.token).toBe("[REDACTED]");
    expect(result.config.port).toBe(3000);
  });

  test("redacts password in deeply nested structure", () => {
    const input = { level1: { level2: { password: "secret", ok: true } } };
    const result = sanitize(input);
    expect(result.level1.level2.password).toBe("[REDACTED]");
    expect(result.level1.level2.ok).toBe(true);
  });

  test("redacts secret and credential keys", () => {
    const input = { secret: "s", credential: "c", normal: "n" };
    const result = sanitize(input);
    expect(result.secret).toBe("[REDACTED]");
    expect(result.credential).toBe("[REDACTED]");
    expect(result.normal).toBe("n");
  });

  test("handles arrays with sensitive values", () => {
    const input = { keys: [{ api_key: "sk-1" }, { safe: "yes" }] };
    const result = sanitize(input);
    expect(result.keys[0].api_key).toBe("[REDACTED]");
    expect(result.keys[1].safe).toBe("yes");
  });

  test("returns same object when no sensitive keys", () => {
    const input = { name: "test", count: 5 };
    const result = sanitize(input);
    expect(result).toEqual(input);
  });

  test("handles null and undefined values", () => {
    const input = { api_key: null, name: undefined };
    const result = sanitize(input);
    expect(result.api_key).toBeNull();
    expect(result.name).toBeUndefined();
  });

  test("handles string values containing sensitive patterns in keys", () => {
    const input = { Authorization: "Bearer sk-123" };
    const result = sanitize(input);
    expect(result.Authorization).toBe("Bearer sk-123");
  });
});
