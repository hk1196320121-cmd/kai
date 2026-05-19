import { describe, test, expect } from "bun:test";
import type { Observation } from "../src/core/profile/types";

describe("Observation source type union", () => {
  test("accepts coldstart source", () => {
    const obs: Observation = {
      id: 1,
      type: "signal",
      key: "coldstart:goal",
      value: "{}",
      confidence: 8,
      source: "coldstart",
      provenance: "{}",
      ts: new Date().toISOString(),
    };
    expect(obs.source).toBe("coldstart");
  });

  test("accepts workspace source", () => {
    const obs: Observation = {
      id: 2,
      type: "signal",
      key: "workspace:task_completed",
      value: "{}",
      confidence: 7,
      source: "workspace",
      provenance: "{}",
      ts: new Date().toISOString(),
    };
    expect(obs.source).toBe("workspace");
  });
});