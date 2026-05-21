import { describe, test, expect } from "bun:test";
import type { LLMProvider } from "../../../src/llm/provider";

// We test JudgeEngine by importing and calling parseJudgeResponse indirectly
// through the public API (judge, majorityVote) with a mock LLM.

function createMockLLM(response: Record<string, unknown>): LLMProvider {
  return {
    call: async () => response,
    callWithModel: async () => response,
    buildHeaders: () => ({}),
    buildRequestBody: () => ({}),
    parseResponse: async (r: any) => r,
    validateWithSchema: () => {},
    getConfig: () => ({ apiKey: "", baseUrl: "", model: "mock" }),
  } as unknown as LLMProvider;
}

// We need to import JudgeEngine. It depends on LLMProvider so we mock that.
const { JudgeEngine } = require("../../../src/core/prompt/judge-engine");

describe("JudgeEngine", () => {
  test("judge returns valid result for winner A", async () => {
    const mockLLM = createMockLLM({
      winner: "a",
      confidence: 0.9,
      reasoning: "A was clearer",
    });
    const engine = new JudgeEngine(mockLLM);
    const result = await engine.judge("output-a", "output-b", "test input");
    expect(result.winner).toBe("a");
    expect(result.confidence).toBe(0.9);
    expect(result.reasoning).toBe("A was clearer");
  });

  test("judge normalizes uppercase winner to lowercase", async () => {
    const mockLLM = createMockLLM({
      winner: "A",
      confidence: 0.8,
      reasoning: "Uppercase A",
    });
    const engine = new JudgeEngine(mockLLM);
    const result = await engine.judge("a", "b", "input");
    expect(result.winner).toBe("a");
  });

  test("judge throws on invalid winner value", async () => {
    const mockLLM = createMockLLM({
      winner: "neither",
      confidence: 0.5,
      reasoning: "Bad winner",
    });
    const engine = new JudgeEngine(mockLLM);
    expect(engine.judge("a", "b", "input")).rejects.toThrow(
      "Invalid judge winner",
    );
  });

  test("judge handles missing winner field", async () => {
    const mockLLM = createMockLLM({
      confidence: 0.5,
      reasoning: "No winner",
    });
    const engine = new JudgeEngine(mockLLM);
    expect(engine.judge("a", "b", "input")).rejects.toThrow(
      "Invalid judge winner",
    );
  });

  test("judge defaults confidence to 0.5 when missing", async () => {
    const mockLLM = createMockLLM({
      winner: "b",
      reasoning: "B wins",
    });
    const engine = new JudgeEngine(mockLLM);
    const result = await engine.judge("a", "b", "input");
    expect(result.winner).toBe("b");
    expect(result.confidence).toBe(0.5);
  });

  test("majorityVote returns consensus winner", async () => {
    let callIndex = 0;
    const responses = [
      { winner: "a", confidence: 0.9, reasoning: "A1" },
      { winner: "a", confidence: 0.8, reasoning: "A2" },
      { winner: "b", confidence: 0.7, reasoning: "B1" },
    ];
    const mockLLM = {
      call: async () => responses[callIndex++],
      callWithModel: async () => responses[callIndex++],
      buildHeaders: () => ({}),
      buildRequestBody: () => ({}),
      parseResponse: async (r: any) => r,
      validateWithSchema: () => {},
      getConfig: () => ({ apiKey: "", baseUrl: "", model: "mock" }),
    } as unknown as LLMProvider;
    const engine = new JudgeEngine(mockLLM);
    const result = await engine.majorityVote("a-out", "b-out", "input", 3);
    expect(result.winner).toBe("a");
    expect(result.confidence).toBeCloseTo(0.8, 1);
  });

  test("majorityVote returns tie when votes are split evenly", async () => {
    let callIndex = 0;
    const responses = [
      { winner: "a", confidence: 0.8, reasoning: "A" },
      { winner: "b", confidence: 0.8, reasoning: "B" },
      { winner: "tie", confidence: 0.5, reasoning: "Tie" },
    ];
    const mockLLM = {
      call: async () => responses[callIndex++],
      callWithModel: async () => responses[callIndex++],
      buildHeaders: () => ({}),
      buildRequestBody: () => ({}),
      parseResponse: async (r: any) => r,
      validateWithSchema: () => {},
      getConfig: () => ({ apiKey: "", baseUrl: "", model: "mock" }),
    } as unknown as LLMProvider;
    const engine = new JudgeEngine(mockLLM);
    const result = await engine.majorityVote("a", "b", "input", 3);
    expect(result.winner).toBe("tie");
  });

  test("majorityVote throws when fewer than 2 calls succeed", async () => {
    const mockLLM = {
      call: async () => {
        throw new Error("LLM down");
      },
      callWithModel: async () => {
        throw new Error("LLM down");
      },
      buildHeaders: () => ({}),
      buildRequestBody: () => ({}),
      parseResponse: async (r: any) => r,
      validateWithSchema: () => {},
      getConfig: () => ({ apiKey: "", baseUrl: "", model: "mock" }),
    } as unknown as LLMProvider;
    const engine = new JudgeEngine(mockLLM);
    expect(engine.majorityVote("a", "b", "input", 3)).rejects.toThrow(
      "Judge majority vote failed",
    );
  });
});
