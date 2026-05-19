import { describe, test, expect, afterEach } from "bun:test";
import { KaiDB } from "../src/db/client";
import { ProfileEngine } from "../src/core/profile/engine";
import { cleanup, tempDb } from "./helpers/temp-db";

describe("setTrait source precedence", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("observed trait does not overwrite declared trait", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.setTrait({
      dimension: "risk_tolerance",
      value: 0.9,
      confidence: 10,
      source: "declared",
      reasoning: "User explicitly stated",
    });

    engine.setTrait({
      dimension: "risk_tolerance",
      value: 0.3,
      confidence: 5,
      source: "observed",
      reasoning: "Cold start derived",
    });

    const traits = engine.getTraits({ dimension: "risk_tolerance" });
    expect(traits.length).toBe(1);
    expect(traits[0].source).toBe("declared");
    expect(traits[0].value).toBe(0.9);

    db.close();
  });

  test("observed overwrites inferred", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.setTrait({
      dimension: "detail_oriented",
      value: 0.3,
      confidence: 3,
      source: "inferred",
      reasoning: "Weak signal",
    });

    engine.setTrait({
      dimension: "detail_oriented",
      value: 0.8,
      confidence: 7,
      source: "observed",
      reasoning: "Cold start derived",
    });

    const traits = engine.getTraits({ dimension: "detail_oriented" });
    expect(traits[0].source).toBe("observed");
    expect(traits[0].value).toBe(0.8);

    db.close();
  });

  test("same-priority source overwrites (normal behavior)", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.setTrait({
      dimension: "planning_style",
      value: 0.5,
      confidence: 5,
      source: "observed",
      reasoning: "First observation",
    });

    engine.setTrait({
      dimension: "planning_style",
      value: 0.7,
      confidence: 7,
      source: "observed",
      reasoning: "Stronger observation",
    });

    const traits = engine.getTraits({ dimension: "planning_style" });
    expect(traits[0].value).toBe(0.7);

    db.close();
  });

  test("declared > corrected > observed > inferred precedence order", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.setTrait({
      dimension: "scope_appetite",
      value: 0.2,
      confidence: 3,
      source: "inferred",
      reasoning: "inferred",
    });
    engine.setTrait({
      dimension: "scope_appetite",
      value: 0.5,
      confidence: 5,
      source: "observed",
      reasoning: "observed",
    });

    expect(
      engine.getTraits({ dimension: "scope_appetite" })[0].source,
    ).toBe("observed");

    engine.setTrait({
      dimension: "scope_appetite",
      value: 0.1,
      confidence: 2,
      source: "inferred",
      reasoning: "inferred again",
    });
    expect(
      engine.getTraits({ dimension: "scope_appetite" })[0].value,
    ).toBe(0.5);

    engine.setTrait({
      dimension: "scope_appetite",
      value: 0.9,
      confidence: 10,
      source: "declared",
      reasoning: "declared",
    });
    expect(
      engine.getTraits({ dimension: "scope_appetite" })[0].source,
    ).toBe("declared");
    expect(
      engine.getTraits({ dimension: "scope_appetite" })[0].value,
    ).toBe(0.9);

    db.close();
  });
});
