import { describe, test, expect, mock } from "bun:test";
import { LLMProvider } from "../src/llm/provider";

describe("LLMProvider", () => {
  test("builds correct request headers", () => {
    const provider = new LLMProvider({ apiKey: "test-key", baseUrl: "http://localhost:11434/v1", model: "test-model" });
    const headers = provider.buildHeaders();
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("builds correct request body with JSON mode", () => {
    const provider = new LLMProvider({ apiKey: "key", baseUrl: "http://localhost:11434/v1", model: "model" });
    const body = provider.buildRequestBody("test prompt", "test system");
    expect(body.model).toBe("model");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
  });

  test("parseResponse extracts valid JSON from response", async () => {
    const provider = new LLMProvider({ apiKey: "key", baseUrl: "http://localhost:11434/v1", model: "model" });
    const mockResponse = {
      choices: [{ message: { content: '{"dimension": "scope_appetite", "value": 0.8}' } }],
    };
    const result = await provider.parseResponse(mockResponse);
    expect(result.dimension).toBe("scope_appetite");
    expect(result.value).toBe(0.8);
  });

  test("parseResponse throws on invalid JSON", async () => {
    const provider = new LLMProvider({ apiKey: "key", baseUrl: "http://localhost:11434/v1", model: "model" });
    const mockResponse = {
      choices: [{ message: { content: "not json at all" } }],
    };
    expect(provider.parseResponse(mockResponse)).rejects.toThrow();
  });

  test("validateWithSchema rejects missing required fields", () => {
    const provider = new LLMProvider({ apiKey: "key", baseUrl: "http://localhost:11434/v1", model: "model" });
    expect(() => provider.validateWithSchema({ dimension: "test" }, ["dimension", "value", "reasoning"]))
      .toThrow("Missing required field: value");
  });

  test("validateWithSchema passes with all fields", () => {
    const provider = new LLMProvider({ apiKey: "key", baseUrl: "http://localhost:11434/v1", model: "model" });
    expect(() => provider.validateWithSchema({ dimension: "test", value: 0.5, reasoning: "test" }, ["dimension", "value", "reasoning"]))
      .not.toThrow();
  });
});
