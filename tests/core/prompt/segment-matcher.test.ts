import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { GeneStore } from "../../../src/core/prompt/gene-store";
import { SegmentMatcher } from "../../../src/core/prompt/segment-matcher";
import { tempDb, cleanup } from "../../helpers/temp-db";
import type { Trait } from "../../../src/core/profile/types";

function makeTrait(dimension: string, value: number, confidence = 8): Trait {
  return {
    id: dimension,
    dimension,
    value,
    confidence,
    source: "observed" as const,
    reasoning: "",
    updated_at: "",
  };
}

describe("SegmentMatcher", () => {
  let db: KaiDB;
  let store: GeneStore;
  let matcher: SegmentMatcher;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb("segment-matcher");
    db = new KaiDB(dbPath);
    store = new GeneStore(db);
    matcher = new SegmentMatcher(store);

    const database = db.getDatabase();
    database.run(
      `INSERT OR IGNORE INTO prompt_segments (id, name, trait_constraints, description) VALUES ('detail_tinkerer', 'detail_tinkerer', '{"detail_oriented":{"min":0.7},"tinkerer":{"min":0.5}}', 'Detail-oriented tinkerer')`,
    );
    database.run(
      `INSERT OR IGNORE INTO prompt_segments (id, name, trait_constraints, description) VALUES ('cautious_planner', 'cautious_planner', '{"risk_tolerance":{"max":0.3},"planning_style":{"min":0.6}}', 'Cautious planner')`,
    );
  });

  afterEach(() => {
    db.close();
    cleanup(dbPath);
  });

  test("returns default segment when no traits provided", () => {
    const result = matcher.match([]);
    expect(result.segment_id).toBe("default");
    expect(result.segment_name).toBe("default");
    expect(result.is_default).toBe(true);
  });

  test("returns default segment when no segments match", () => {
    const traits = [
      makeTrait("scope_appetite", 0.5),
      makeTrait("some_other", 0.9),
      makeTrait("unrelated", 0.3),
    ];
    const result = matcher.match(traits);
    expect(result.segment_id).toBe("default");
    expect(result.is_default).toBe(true);
  });

  test("matches detail_tinkerer segment", () => {
    const traits = [
      makeTrait("detail_oriented", 0.8),
      makeTrait("tinkerer", 0.7),
      makeTrait("scope_appetite", 0.5),
    ];
    const result = matcher.match(traits);
    expect(result.segment_id).toBe("detail_tinkerer");
    expect(result.constraints_satisfied).toBe(2);
    expect(result.is_default).toBe(false);
  });

  test("matches cautious_planner segment", () => {
    const traits = [
      makeTrait("risk_tolerance", 0.2),
      makeTrait("planning_style", 0.8),
      makeTrait("scope_appetite", 0.5),
    ];
    const result = matcher.match(traits);
    expect(result.segment_id).toBe("cautious_planner");
    expect(result.is_default).toBe(false);
  });

  test("picks segment with most constraints satisfied when multiple match", () => {
    const database = db.getDatabase();
    database.run(
      `INSERT OR IGNORE INTO prompt_segments (id, name, trait_constraints, description) VALUES ('super_match', 'super_match', '{"detail_oriented":{"min":0.7},"tinkerer":{"min":0.5},"scope_appetite":{"min":0.3}}', 'Matches more constraints')`,
    );

    const traits = [
      makeTrait("detail_oriented", 0.8),
      makeTrait("tinkerer", 0.7),
      makeTrait("scope_appetite", 0.5),
    ];
    const result = matcher.match(traits);
    expect(result.segment_id).toBe("super_match");
    expect(result.constraints_satisfied).toBe(3);
    expect(result.is_default).toBe(false);
  });

  test("skips traits with low confidence", () => {
    // detail_oriented has low confidence (2), so it gets filtered out
    // Without detail_oriented at high confidence, detail_tinkerer can't match
    // We only have 2 high-confidence traits, so we fall back to default
    const traits = [
      makeTrait("detail_oriented", 0.8, 2),
      makeTrait("tinkerer", 0.7, 8),
      makeTrait("scope_appetite", 0.5, 8),
    ];
    const result = matcher.match(traits);
    expect(result.segment_id).toBe("default");
    expect(result.is_default).toBe(true);
  });

  test("returns default for profile with < 3 high-confidence traits", () => {
    const traits = [
      makeTrait("detail_oriented", 0.8),
      makeTrait("tinkerer", 0.7),
    ];
    const result = matcher.match(traits);
    expect(result.segment_id).toBe("default");
    expect(result.is_default).toBe(true);
  });
});
