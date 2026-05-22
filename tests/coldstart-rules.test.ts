import { describe, test, expect, afterEach } from "bun:test";
import { KaiDB } from "../src/db/client";
import { ProfileEngine } from "../src/core/profile/engine";
import { Derivator } from "../src/core/profile/derivator";
import { cleanup, tempDb } from "./helpers/temp-db";

describe("Coldstart derivation rules", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("coldstart:signal.detail_level with high detail", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.detail_level",
      value: JSON.stringify({ level: "high", word_count: 45, has_specifics: true }),
      confidence: 7,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const detail = results.find((r) => r.dimension === "detail_oriented");
    expect(detail).toBeDefined();
    expect(detail!.value).toBeGreaterThan(0);

    db.close();
  });

  test("coldstart:signal.comm_style derives comm_style trait", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.comm_style",
      value: JSON.stringify({ style: "verbose", word_count: 50 }),
      confidence: 6,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const comm = results.find((r) => r.dimension === "comm_style");
    expect(comm).toBeDefined();
    expect(comm!.value).toBeGreaterThan(0);

    db.close();
  });

  test("coldstart:signal.domain derives domain_context trait", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: ["engineering", "research"] }),
      confidence: 7,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const domain = results.find((r) => r.dimension === "domain_context");
    expect(domain).toBeDefined();
    expect(domain!.value).toBeGreaterThan(0);

    db.close();
  });

  test("coldstart:format derives preferred_output_shape trait", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:format",
      value: JSON.stringify({ format: "checklist" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const shape = results.find((r) => r.dimension === "preferred_output_shape");
    expect(shape).toBeDefined();

    db.close();
  });

  test("workspace:task_* derives task_completion_rate", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    for (let i = 0; i < 3; i++) {
      engine.addObservation({
        type: "signal",
        key: "workspace:task_completed",
        value: '{"task_id": "t' + i + '"}',
        confidence: 7,
        source: "workspace",
        provenance: '{"origin":"workspace_event_bus"}',
      });
    }

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const tcr = results.find((r) => r.dimension === "task_completion_rate");
    expect(tcr).toBeDefined();
    expect(tcr!.value).toBeGreaterThan(0);

    db.close();
  });

  test("deriveFromRules with persist=false does not write traits", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: ["engineering"] }),
      confidence: 7,
      source: "coldstart",
      provenance: '{"origin":"test"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules(false);

    expect(results.length).toBeGreaterThan(0);
    const traits = engine.getTraits();
    expect(traits.length).toBe(0);

    db.close();
  });

  test("deriveFromRules with persist=true writes traits (default)", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: ["engineering"] }),
      confidence: 7,
      source: "coldstart",
      provenance: '{"origin":"test"}',
    });

    const derivator = new Derivator(engine);
    derivator.deriveFromRules(true);

    const traits = engine.getTraits();
    expect(traits.length).toBeGreaterThan(0);

    db.close();
  });

  test("deriveFromValues is called when present on a rule", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:planning_style",
      value: JSON.stringify({ answer: "detailed plan" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const planning = results.find((r) => r.dimension === "planning_style");
    expect(planning).toBeDefined();
    expect(planning!.value).toBe(0.9);
    expect(planning!.confidence).toBe(8);
    expect(planning!.reasoning).toContain("detailed plan");

    db.close();
  });

  test("schedule_rhythm: derives from coldstart answer value", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:schedule_rhythm",
      value: JSON.stringify({ answer: "morning" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const schedule = results.find((r) => r.dimension === "schedule_rhythm");
    expect(schedule).toBeDefined();
    expect(schedule!.value).toBe(0.9);

    db.close();
  });

  test("preferred_output_shape: derives from coldstart answer value", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:preferred_output_shape",
      value: JSON.stringify({ answer: "checklist" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const shape = results.find((r) => r.dimension === "preferred_output_shape");
    expect(shape).toBeDefined();
    expect(shape!.value).toBe(0.9);

    db.close();
  });

  test("disliked_behavior: derives from coldstart answer", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.addObservation({
      type: "signal",
      key: "coldstart:disliked_behavior",
      value: JSON.stringify({ answer: "acts without asking" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const results = derivator.deriveFromRules();
    const disliked = results.find((r) => r.dimension === "disliked_behavior");
    expect(disliked).toBeDefined();
    expect(disliked!.value).toBeGreaterThan(0);

    db.close();
  });
});
