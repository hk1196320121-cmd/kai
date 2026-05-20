// tests/core/orchestrator/profile-context.test.ts
import { describe, test, expect } from "bun:test";
import { formatProfileContext, DEFAULT_TRAITS } from "../../../src/core/orchestrator/profile-context";
import type { Trait } from "../../../src/core/profile/types";

describe("formatProfileContext", () => {
  test("returns defaults when no traits provided", () => {
    const ctx = formatProfileContext([]);
    expect(ctx).toContain("detail_oriented");
    expect(ctx).toContain("0.5");
  });

  test("uses actual trait values when present", () => {
    const traits: Trait[] = [
      { id: "1", dimension: "detail_oriented", value: 0.9, confidence: 8, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
      { id: "2", dimension: "risk_tolerance", value: 0.3, confidence: 6, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];
    const ctx = formatProfileContext(traits);
    expect(ctx).toContain("detail_oriented: 0.9");
    expect(ctx).toContain("risk_tolerance: 0.3");
  });

  test("fills missing dimensions with defaults", () => {
    const traits: Trait[] = [
      { id: "1", dimension: "early_riser", value: 0.8, confidence: 7, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];
    const ctx = formatProfileContext(traits);
    expect(ctx).toContain("early_riser: 0.8");
    expect(ctx).toContain("detail_oriented: 0.5");
  });

  test("includes scheduling guidance for high early_riser", () => {
    const traits: Trait[] = [
      { id: "1", dimension: "early_riser", value: 0.9, confidence: 8, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];
    const ctx = formatProfileContext(traits);
    expect(ctx).toContain("morning");
  });

  test("includes decomposition guidance for high detail_oriented", () => {
    const traits: Trait[] = [
      { id: "1", dimension: "detail_oriented", value: 0.85, confidence: 7, source: "observed", reasoning: "test", updated_at: "2026-05-20" },
    ];
    const ctx = formatProfileContext(traits);
    expect(ctx).toContain("fine-grained");
  });
});
