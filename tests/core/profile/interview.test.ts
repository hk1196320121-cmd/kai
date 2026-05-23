import { describe, test, expect, afterEach } from "bun:test";
import { InterviewEngine } from "../../../src/core/profile/interview";
import type { AddObservationInput } from "../../../src/core/profile/engine";
import { cleanup, tempDb } from "../../helpers/temp-db";

describe("InterviewEngine", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("extractSignalsFromAnswers produces observations for each answer", () => {
    dbPath = tempDb();
    const answers = [
      { slug: "goal", text: "Build a REST API" },
      { slug: "planning_style", text: "detailed plan" },
      { slug: "schedule_rhythm", text: "morning" },
    ];
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(answers, [], "ws-1");
    expect(signals.length).toBeGreaterThanOrEqual(3);
    expect(signals.every((s) => s.source === "coldstart")).toBe(true);
    expect(signals.some((s) => s.key === "coldstart:goal")).toBe(true);
    expect(signals.some((s) => s.key === "coldstart:planning_style")).toBe(true);
    expect(signals.some((s) => s.key === "coldstart:schedule_rhythm")).toBe(true);
  });

  test("extractSignalsFromAnswers includes domain signal for engineering keywords", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [{ slug: "goal", text: "I want to debug the API and deploy new code" }],
      [],
      "ws-1",
    );
    const domain = signals.find((s) => s.key === "coldstart:signal.domain");
    expect(domain).toBeDefined();
    const parsed = JSON.parse(domain!.value);
    expect(parsed.domains).toContain("engineering");
  });

  test("extractSignalsFromAnswers includes aggregate detail_level signal", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [
        { slug: "goal", text: "Build a comprehensive API with authentication, rate limiting, and full audit logging" },
        { slug: "success", text: "All endpoints tested with 90% coverage, deployed with zero-downtime" },
      ],
      [],
      "ws-1",
    );
    const detail = signals.find((s) => s.key === "coldstart:signal.detail_level");
    expect(detail).toBeDefined();
    const parsed = JSON.parse(detail!.value);
    expect(parsed.level).toBe("high");
  });

  test("extractSignalsFromAnswers maps trait-targeted answers to correct observation keys", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [
        { slug: "planning_style", text: "rough outline" },
        { slug: "risk_tolerance", text: "after basic testing" },
        { slug: "autonomy", text: "suggest only" },
      ],
      [],
      "ws-1",
    );
    expect(signals.find((s) => s.key === "coldstart:planning_style")).toBeDefined();
    expect(signals.find((s) => s.key === "coldstart:risk_tolerance")).toBeDefined();
    expect(signals.find((s) => s.key === "coldstart:autonomy")).toBeDefined();
  });

  test("extractSignalsFromAnswers includes comm_style signal", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [{ slug: "goal", text: "Hi" }],
      [],
      "ws-1",
    );
    const comm = signals.find((s) => s.key === "coldstart:signal.comm_style");
    expect(comm).toBeDefined();
    const parsed = JSON.parse(comm!.value);
    expect(parsed.style).toBe("terse");
  });
});
