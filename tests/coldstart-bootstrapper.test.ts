import { describe, test, expect, afterEach } from "bun:test";
import { InterviewEngine } from "../src/core/profile/interview";
import { Derivator } from "../src/core/profile/derivator";
import { ProfileEngine } from "../src/core/profile/engine";
import { recommendTasks } from "../src/core/orchestrator/recommend";
import { resolveIdeaDomain } from "../src/core/orchestrator/domain-resolver";
import { KaiDB } from "../src/db/client";
import { cleanup, tempDb } from "./helpers/temp-db";

describe("Cold Start Bootstrapper Integration", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("full flow: answers → signals → derivation → recommendations", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.createIdentity({ name: "Test", role: "engineer" });

    const answers = [
      { slug: "goal", text: "Build a REST API for user management" },
      { slug: "success", text: "All endpoints tested, deployed to staging" },
      { slug: "constraints", text: "2 weeks deadline" },
      { slug: "domain", text: "engineering" },
      { slug: "planning_style", text: "detailed plan" },
      { slug: "schedule_rhythm", text: "morning" },
      { slug: "preferred_output_shape", text: "checklist" },
      { slug: "risk_tolerance", text: "after basic testing" },
      { slug: "autonomy", text: "suggest only" },
      { slug: "disliked_behavior", text: "acts without asking" },
    ];

    const interview = new InterviewEngine();
    const signals = interview.extractSignalsFromAnswers(answers, [], "ws-1");
    expect(signals.length).toBeGreaterThan(0);

    for (const obs of signals) {
      engine.addObservation(obs);
    }

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules();
    expect(traits.length).toBeGreaterThan(0);

    const planningStyle = traits.find((t) => t.dimension === "planning_style");
    expect(planningStyle).toBeDefined();
    expect(planningStyle!.value).toBe(0.9);

    const schedule = traits.find((t) => t.dimension === "schedule_rhythm");
    expect(schedule).toBeDefined();
    expect(schedule!.value).toBe(0.9);

    const savedTraits = engine.getTraits();
    const domain = signals.find((s) => s.key === "coldstart:signal.domain");
    const domainValue = domain
      ? JSON.parse(domain.value).domains?.[0] ?? "general"
      : "general";
    const ideaDomain = resolveIdeaDomain(domainValue);

    const recommendations = recommendTasks(savedTraits, ideaDomain);
    expect(recommendations.length).toBe(3);
    expect(recommendations[0].score).toBeGreaterThan(0);

    db.close();
  });

  test("signals include coldstart:signal.domain for engineering answers", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);

    const answers = [
      { slug: "goal", text: "Build and deploy an API" },
      { slug: "success", text: "Code passes all tests" },
      { slug: "domain", text: "engineering" },
    ];

    const interview = new InterviewEngine();
    const signals = interview.extractSignalsFromAnswers(answers, [], "ws-2");

    const domain = signals.find((s) => s.key === "coldstart:signal.domain");
    expect(domain).toBeDefined();
    const parsed = JSON.parse(domain!.value);
    expect(parsed.domains).toContain("engineering");

    db.close();
  });

  test("recommendations produce 3 results with valid scores", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.createIdentity({ name: "RecTest", role: "engineer" });

    const answers = [
      { slug: "goal", text: "Write a research paper" },
      { slug: "success", text: "Paper published" },
      { slug: "domain", text: "research" },
      { slug: "planning_style", text: "rough outline" },
      { slug: "schedule_rhythm", text: "evening" },
      { slug: "preferred_output_shape", text: "brief" },
      { slug: "risk_tolerance", text: "when it compiles" },
      { slug: "autonomy", text: "act autonomously" },
      { slug: "disliked_behavior", text: "too cautious" },
    ];

    const interview = new InterviewEngine();
    const signals = interview.extractSignalsFromAnswers(answers, [], "ws-3");
    for (const obs of signals) {
      engine.addObservation(obs);
    }

    const derivator = new Derivator(engine);
    derivator.deriveFromRules();

    const savedTraits = engine.getTraits();
    const recommendations = recommendTasks(savedTraits, "research");

    expect(recommendations.length).toBe(3);
    for (const rec of recommendations) {
      expect(rec.score).toBeGreaterThan(0);
      expect(rec.title).toBeTruthy();
      expect(rec.description).toBeTruthy();
      expect(rec.explanation).toBeTruthy();
      expect(rec.templateId).toBeTruthy();
    }

    db.close();
  });
});
