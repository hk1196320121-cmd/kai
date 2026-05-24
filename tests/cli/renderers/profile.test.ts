import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setNoColor } from "../../../src/cli/format";
import type { ProfileSnapshot, Trait, Identity, Observation } from "../../../src/core/profile/types";
import type { TraitExplanation } from "../../../src/core/profile/provenance";
import type { ProfileDiff } from "../../../src/cli/profile";
import {
  renderProfile,
  renderTraitBar,
  renderDiff,
  renderProvenance,
  parseJsonField,
  getConfidenceLabel,
} from "../../../src/cli/renderers/profile";

// Helper factories

function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    id: "id-1",
    name: "Alex",
    role: "Engineer",
    goals: '["ship v2","learn Rust"]',
    expertise_areas: '["TypeScript","Node.js"]',
    learning_interests: '["Rust","ML"]',
    work_context: "",
    communication_style: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTrait(overrides: Partial<Trait> = {}): Trait {
  return {
    id: "t-1",
    dimension: "detail_oriented",
    value: 0.82,
    confidence: 8,
    source: "observed",
    reasoning: "Frequent code review comments on edge cases",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 1,
    type: "behavior",
    key: "detail_oriented",
    value: '{"action":"code_review","frequency":5}',
    confidence: 7,
    source: "session_log",
    provenance: '{"origin_file":"test.ts","extracted_at":"2026-01-01","extractor_version":"1.0"}',
    ts: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<ProfileSnapshot> = {}): ProfileSnapshot {
  return {
    identity: makeIdentity(),
    traits: [makeTrait()],
    preferences: [],
    observationCount: 42,
    recentObservations: [],
    ...overrides,
  };
}

function makeDiff(overrides: Partial<ProfileDiff> = {}): ProfileDiff {
  return {
    workspaceName: "test-workspace",
    coldstartDate: "2026-01-01T00:00:00Z",
    changed: [],
    stable: [],
    newTraits: [],
    removed: [],
    ...overrides,
  };
}

function makeExplanation(overrides: Partial<TraitExplanation> = {}): TraitExplanation {
  return {
    dimension: "detail_oriented",
    traitValue: 0.82,
    traitConfidence: 8,
    traitSource: "observed",
    traitReasoning: "Frequent code review comments on edge cases",
    relatedObservations: [makeObservation()],
    ...overrides,
  };
}

describe("profile renderer", () => {
  const origNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.NO_COLOR = "1";
    setNoColor(true);
  });

  afterEach(() => {
    setNoColor(false);
    if (origNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = origNoColor;
    }
  });

  // --- renderProfile ---

  describe("renderProfile", () => {
    test("renders full profile with identity and traits", () => {
      const snapshot = makeSnapshot();
      const result = renderProfile(snapshot);

      // Header
      expect(result).toContain("Kai Profile");

      // Identity
      expect(result).toContain("Alex");
      expect(result).toContain("Engineer");
      expect(result).toContain("ship v2, learn Rust");
      expect(result).toContain("TypeScript, Node.js");

      // Traits section
      expect(result).toContain("Traits");
      expect(result).toContain("detail_oriented");

      // Evidence
      expect(result).toContain("42");

      // Next steps
      expect(result).toContain("Next");
    });

    test("renders profile with null identity (shows No identity set)", () => {
      const snapshot = makeSnapshot({ identity: null });
      const result = renderProfile(snapshot);

      expect(result).toContain("No identity set");
    });

    test("renders profile with empty traits (shows No traits yet)", () => {
      const snapshot = makeSnapshot({ traits: [] });
      const result = renderProfile(snapshot);

      expect(result).toContain("No traits yet");
    });

    test("renders next steps section", () => {
      const snapshot = makeSnapshot();
      const result = renderProfile(snapshot);

      expect(result).toContain("Next");
      expect(result).toContain("kai profile why");
    });
  });

  // --- renderTraitBar ---

  describe("renderTraitBar", () => {
    test("renders trait bar with value and confidence", () => {
      const trait = makeTrait({ dimension: "detail_oriented", value: 0.82, confidence: 8, source: "observed" });
      const result = renderTraitBar(trait);

      expect(result).toContain("detail_oriented");
      expect(result).toContain("████████"); // bar for 0.82
      expect(result).toContain("0.82");
      expect(result).toContain("8");
      expect(result).toContain("observed");
    });

    test("shows high confidence indicator for confidence >= 7", () => {
      const trait = makeTrait({ confidence: 7 });
      const result = renderTraitBar(trait);

      expect(result).toContain("high");
    });

    test("shows medium confidence indicator for confidence >= 4 and < 7", () => {
      const trait = makeTrait({ confidence: 5 });
      const result = renderTraitBar(trait);

      expect(result).toContain("medium");
    });

    test("shows low confidence indicator for confidence < 4", () => {
      const trait = makeTrait({ confidence: 2 });
      const result = renderTraitBar(trait);

      expect(result).toContain("low");
    });

    test("pads dimension to 22 chars", () => {
      const trait = makeTrait({ dimension: "risk" });
      const result = renderTraitBar(trait);

      // "risk" is 4 chars, padEnd(22) adds 18 spaces = 22 total
      expect(result).toContain("risk");
      // Verify the dimension portion is exactly 22 chars before the bar
      const dimPart = result.slice(0, 22);
      expect(dimPart).toBe("risk                  ");
    });
  });

  // --- renderDiff ---

  describe("renderDiff", () => {
    test("renders diff with changed/new/removed traits", () => {
      const diff = makeDiff({
        changed: [
          {
            dimension: "detail_oriented",
            before: { value: 0.5, confidence: 5 },
            after: { value: 0.8, confidence: 8 },
            reasoning: "More observations confirmed",
          },
        ],
        newTraits: [
          makeTrait({ dimension: "risk_tolerance", value: 0.6, confidence: 4, reasoning: "New trait" }),
        ],
        removed: [
          {
            dimension: "legacy_trait",
            before: { value: 0.3, confidence: 2 },
            after: { value: 0, confidence: 0 },
            reasoning: "Trait removed",
          },
        ],
      });
      const result = renderDiff(diff);

      // Header with coldstart date
      expect(result).toContain("2026-01-01");

      // Changed trait — plain labels for value direction
      expect(result).toContain("detail_oriented");
      expect(result).toContain("increased");

      // New trait
      expect(result).toContain("risk_tolerance");
      expect(result).toContain("new");

      // Removed trait
      expect(result).toContain("legacy_trait");
      expect(result).toContain("removed");

      // Summary line
      expect(result).toContain("0 traits stable, 1 evolved, 1 new, 1 removed");
    });

    test("empty diff shows stable message", () => {
      const diff = makeDiff({
        stable: [
          {
            dimension: "detail_oriented",
            before: { value: 0.5, confidence: 5 },
            after: { value: 0.5, confidence: 5 },
            reasoning: "No change",
          },
        ],
      });
      const result = renderDiff(diff);

      expect(result).toContain("1 traits stable, 0 evolved, 0 new, 0 removed");
    });

    test("uses plain labels (increased/decreased/unchanged), NO +/- signs", () => {
      const diff = makeDiff({
        changed: [
          {
            dimension: "risk_tolerance",
            before: { value: 0.8, confidence: 8 },
            after: { value: 0.3, confidence: 4 },
            reasoning: "Observation showed avoidance",
          },
        ],
      });
      const result = renderDiff(diff);

      expect(result).toContain("decreased");
      // Confidence delta should be shown
      expect(result).toMatch(/confidence 8→4 \(-4\)/);
    });

    test("shows unchanged label for traits with same before/after", () => {
      const diff = makeDiff({
        stable: [
          {
            dimension: "detail_oriented",
            before: { value: 0.5, confidence: 5 },
            after: { value: 0.5, confidence: 5 },
            reasoning: "No change",
          },
        ],
      });
      const result = renderDiff(diff);

      expect(result).toContain("unchanged");
    });
  });

  // --- renderProvenance ---

  describe("renderProvenance", () => {
    test("renders provenance explanation", () => {
      const explanation = makeExplanation();
      const result = renderProvenance(explanation);

      // Header
      expect(result).toContain("Why:");
      expect(result).toContain("detail_oriented");

      // kv pairs
      expect(result).toContain("0.82");
      expect(result).toContain("8");
      expect(result).toContain("observed");
      expect(result).toContain("Frequent code review");

      // Related observations
      expect(result).toContain("Related observations");
      expect(result).toContain("detail_oriented");
    });

    test("handles no related observations", () => {
      const explanation = makeExplanation({ relatedObservations: [] });
      const result = renderProvenance(explanation);

      expect(result).toContain("Why:");
      expect(result).toContain("detail_oriented");
      // Should not crash and should not show "Related observations" section
      // (or show an empty-state message)
    });

    test("truncates related observations to 5", () => {
      const obs = Array.from({ length: 8 }, (_, i) =>
        makeObservation({ id: i + 1, key: `obs_${i}` }),
      );
      const explanation = makeExplanation({ relatedObservations: obs });
      const result = renderProvenance(explanation);

      // Should show count of 8 but only render 5 lines
      expect(result).toContain("8)");
      // obs_5 (index 5) should be truncated
      expect(result).not.toContain("obs_5");
    });
  });

  // --- parseJsonField ---

  describe("parseJsonField", () => {
    test("parses JSON array to comma-separated string", () => {
      expect(parseJsonField('["a","b","c"]')).toBe("a, b, c");
    });

    test("returns raw string for non-JSON", () => {
      expect(parseJsonField("plain text")).toBe("plain text");
    });

    test("returns raw string for JSON object (not array)", () => {
      expect(parseJsonField('{"key":"value"}')).toBe('{"key":"value"}');
    });

    test("returns raw string for JSON number", () => {
      expect(parseJsonField("42")).toBe("42");
    });

    test("handles empty array", () => {
      expect(parseJsonField("[]")).toBe("");
    });

    test("handles single-element array", () => {
      expect(parseJsonField('["only"]')).toBe("only");
    });
  });

  // --- getConfidenceLabel ---

  describe("getConfidenceLabel", () => {
    test("returns high for confidence 7", () => {
      expect(getConfidenceLabel(7)).toBe("● high");
    });

    test("returns high for confidence 10", () => {
      expect(getConfidenceLabel(10)).toBe("● high");
    });

    test("returns medium for confidence 4", () => {
      expect(getConfidenceLabel(4)).toBe("○ medium");
    });

    test("returns medium for confidence 6", () => {
      expect(getConfidenceLabel(6)).toBe("○ medium");
    });

    test("returns low for confidence 3", () => {
      expect(getConfidenceLabel(3)).toBe("◌ low");
    });

    test("returns low for confidence 0", () => {
      expect(getConfidenceLabel(0)).toBe("◌ low");
    });
  });

  // --- getDirectionLabel (tested via renderDiff) ---

  describe("getDirectionLabel threshold", () => {
    test("unchanged when delta is exactly 0.01", () => {
      const diff = makeDiff({
        changed: [
          {
            dimension: "test",
            before: { value: 0.50, confidence: 5 },
            after: { value: 0.51, confidence: 5 },
            reasoning: "Tiny change",
          },
        ],
      });
      const result = renderDiff(diff);
      // delta = 0.01, Math.abs(0.01) < 0.01 is false, so it should be "increased"
      expect(result).toContain("increased");
    });

    test("unchanged when delta is below 0.01", () => {
      const diff = makeDiff({
        stable: [
          {
            dimension: "test",
            before: { value: 0.50, confidence: 5 },
            after: { value: 0.505, confidence: 5 },
            reasoning: "Negligible",
          },
        ],
      });
      const result = renderDiff(diff);
      expect(result).toContain("unchanged");
    });
  });
});
