import { afterEach, describe, expect, test } from "bun:test";
import { resolveIdeaDomain } from "../src/core/orchestrator/domain-resolver";
import { InterviewEngine } from "../src/core/profile/interview";
import { Derivator } from "../src/core/profile/derivator";
import { ProfileEngine } from "../src/core/profile/engine";
import { recommendTasks } from "../src/core/orchestrator/recommend";
import { matchTemplates } from "../src/core/orchestrator/templates";
import { KaiDB } from "../src/db/client";
import { WorkspaceStore } from "../src/workspace/store";
import { cleanup, tempDb } from "./helpers/temp-db";

// ============================================================
// 1. domain-resolver: resolveIdeaDomain edge cases
// ============================================================
describe("resolveIdeaDomain", () => {
  test("maps engineering -> coding", () => {
    expect(resolveIdeaDomain("engineering")).toBe("coding");
  });

  test("maps design -> creative", () => {
    expect(resolveIdeaDomain("design")).toBe("creative");
  });

  test("maps management -> management", () => {
    expect(resolveIdeaDomain("management")).toBe("management");
  });

  test("maps research -> research", () => {
    expect(resolveIdeaDomain("research")).toBe("research");
  });

  test("maps writing -> writing", () => {
    expect(resolveIdeaDomain("writing")).toBe("writing");
  });

  test("maps other -> general", () => {
    expect(resolveIdeaDomain("other")).toBe("general");
  });

  test("unknown string returns general (fallback)", () => {
    expect(resolveIdeaDomain("unknown-value")).toBe("general");
  });

  test("empty string returns general", () => {
    expect(resolveIdeaDomain("")).toBe("general");
  });
});

// ============================================================
// 2. InterviewEngine: explicit domain answer takes priority over keyword heuristic
// ============================================================
describe("InterviewEngine: explicit domain answer", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("explicit 'domain' answer is used, keyword heuristic skips duplicate", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [
        { slug: "goal", text: "I deploy code and debug APIs" },
        { slug: "domain", text: "engineering" },
      ],
      [],
      "ws-domain-priority",
    );
    const domain = signals.find((s) => s.key === "coldstart:signal.domain");
    expect(domain).toBeDefined();
    const parsed = JSON.parse(domain!.value);
    // "engineering" should appear exactly once (not duplicated by keyword heuristic)
    const engCount = parsed.domains.filter((d: string) => d === "engineering").length;
    expect(engCount).toBe(1);
  });

  test("explicit domain='design' prevents keyword heuristic from re-adding it", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [
        { slug: "goal", text: "I want to design wireframes and UX prototypes" },
        { slug: "domain", text: "design" },
      ],
      [],
      "ws-design-dedup",
    );
    const domain = signals.find((s) => s.key === "coldstart:signal.domain");
    expect(domain).toBeDefined();
    const parsed = JSON.parse(domain!.value);
    const designCount = parsed.domains.filter((d: string) => d === "design").length;
    expect(designCount).toBe(1);
  });

  test("explicit domain='management' with management keywords skips duplicate", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [
        { slug: "goal", text: "Manage my team sprints and roadmap" },
        { slug: "domain", text: "management" },
      ],
      [],
      "ws-mgmt-dedup",
    );
    const domain = signals.find((s) => s.key === "coldstart:signal.domain");
    expect(domain).toBeDefined();
    const parsed = JSON.parse(domain!.value);
    const mgmtCount = parsed.domains.filter((d: string) => d === "management").length;
    expect(mgmtCount).toBe(1);
  });

  test("invalid domain answer falls through to keyword-only detection", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [
        { slug: "goal", text: "Build and deploy code" },
        { slug: "domain", text: "something-not-valid" },
      ],
      [],
      "ws-invalid-domain",
    );
    const domain = signals.find((s) => s.key === "coldstart:signal.domain");
    expect(domain).toBeDefined();
    const parsed = JSON.parse(domain!.value);
    // keyword heuristic should still detect "engineering" from "deploy code"
    expect(parsed.domains).toContain("engineering");
  });
});

// ============================================================
// 3. Derivator: coldstart:domain -> domain_context rule (unstaged change)
// ============================================================
describe("Derivator: domain_context from coldstart:domain", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("coldstart:domain observation derives domain_context trait", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "DomCtx", role: "engineer" });

    engine.addObservation({
      type: "signal",
      key: "coldstart:domain",
      value: JSON.stringify({ answer: "engineering", workspace_id: "ws-1" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules();
    const domainCtx = traits.find((t) => t.dimension === "domain_context");
    expect(domainCtx).toBeDefined();
    expect(domainCtx!.value).toBe(0.8);
    expect(domainCtx!.confidence).toBe(9);
    expect(domainCtx!.reasoning).toContain("domain selection");

    db.close();
  });
});

// ============================================================
// 4. Workspace events: new recommendation event types work end-to-end
// ============================================================
describe("WorkspaceStore: new event types", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("addEvent + getEventCounts for recommendation events", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Event Test" });

    store.addEvent({
      workspace_id: ws.id,
      event_type: "recommendation_shown",
      payload: JSON.stringify({ recommendations: ["daily-standup"] }),
    });
    store.addEvent({
      workspace_id: ws.id,
      event_type: "recommendation_accepted",
      payload: JSON.stringify({ template_id: "daily-standup" }),
    });
    store.addEvent({
      workspace_id: ws.id,
      event_type: "task_auto_executed",
      payload: JSON.stringify({ task_id: "t1" }),
    });

    const counts = store.getEventCountsByWorkspaces([ws.id]);
    expect(counts.get(ws.id)).toBe(3);

    db.close();
  });

  test("recommendation_rejected event type is accepted", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const store = new WorkspaceStore(db);

    const ws = store.createWorkspace({ name: "Reject Test" });

    expect(() => {
      store.addEvent({
        workspace_id: ws.id,
        event_type: "recommendation_rejected",
        payload: JSON.stringify({ template_id: "bug-triage" }),
      });
    }).not.toThrow();

    db.close();
  });
});

// ============================================================
// 5. Derivator: disliked_behavior deriveFromValues pattern matching
// ============================================================
describe("Derivator: disliked_behavior pattern matching", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("detects 'too verbose' pattern", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Dislike", role: "engineer" });

    engine.addObservation({
      type: "signal",
      key: "coldstart:disliked_behavior",
      value: JSON.stringify({ answer: "too verbose" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules();
    const disliked = traits.find((t) => t.dimension === "disliked_behavior");
    expect(disliked).toBeDefined();
    expect(disliked!.reasoning).toContain("verbosity");

    db.close();
  });

  test("detects 'too cautious' pattern", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Cautious", role: "engineer" });

    engine.addObservation({
      type: "signal",
      key: "coldstart:disliked_behavior",
      value: JSON.stringify({ answer: "too cautious" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules();
    const disliked = traits.find((t) => t.dimension === "disliked_behavior");
    expect(disliked).toBeDefined();
    expect(disliked!.reasoning).toContain("overcaution");

    db.close();
  });

  test("detects 'asks too many questions' pattern", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Questions", role: "engineer" });

    engine.addObservation({
      type: "signal",
      key: "coldstart:disliked_behavior",
      value: JSON.stringify({ answer: "asks too many questions" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules();
    const disliked = traits.find((t) => t.dimension === "disliked_behavior");
    expect(disliked).toBeDefined();
    expect(disliked!.reasoning).toContain("question_overload");

    db.close();
  });

  test("detects 'ignores context' pattern", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Context", role: "engineer" });

    engine.addObservation({
      type: "signal",
      key: "coldstart:disliked_behavior",
      value: JSON.stringify({ answer: "ignores context" }),
      confidence: 8,
      source: "coldstart",
      provenance: '{"origin":"kai work start"}',
    });

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules();
    const disliked = traits.find((t) => t.dimension === "disliked_behavior");
    expect(disliked).toBeDefined();
    expect(disliked!.reasoning).toContain("context_blindness");

    db.close();
  });
});

// ============================================================
// 6. matchTemplates: edge case with empty trait list
// ============================================================
describe("matchTemplates edge cases", () => {
  test("returns max 5 results even with many templates", () => {
    const results = matchTemplates([], "coding");
    expect(results.length).toBeLessThanOrEqual(5);
  });

  test("score is capped at 1.0 (no overflow)", () => {
    const traits = [
      { dimension: "detail_oriented", value: 1.0, confidence: 10 },
      { dimension: "planning_style", value: 1.0, confidence: 10 },
      { dimension: "risk_tolerance", value: 0.3, confidence: 10 },
      { dimension: "preferred_output_shape", value: 0.9, confidence: 10 },
    ];
    const results = matchTemplates(traits, "coding");
    for (const r of results) {
      expect(r.score).toBeLessThanOrEqual(1.0);
    }
  });

  test("templates with no trait_targets get base score 0.5 with general domain", () => {
    const results = matchTemplates([], "general");
    // project-retrospective and weekly-review have empty trait_targets
    const generics = results.filter(
      (r) => Object.keys(r.template.trait_targets).length === 0 && r.template.domain === "general",
    );
    // They get 0.5 base score, no domain bonus since domain is "general"
    for (const g of generics) {
      expect(g.score).toBe(0.5);
    }
  });

  test("templates with no trait_targets get domain bonus if domain matches", () => {
    const results = matchTemplates([], "management");
    // sprint-planner has trait_targets, but project-retrospective has empty targets with management domain
    // It may not be in top 5 but sprint-planner (management domain) should be present
    const managementTemplates = results.filter((r) => r.template.domain === "management");
    expect(managementTemplates.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 7. recommendTasks: edge case — all templates filtered out
// ============================================================
describe("recommendTasks edge cases", () => {
  test("returns 3 recommendations with empty traits and general domain", () => {
    const results = recommendTasks([], "general");
    expect(results.length).toBe(3);
  });

  test("each recommendation has all required fields", () => {
    const results = recommendTasks(
      [{ dimension: "detail_oriented", value: 0.5, confidence: 5 }],
      "coding",
    );
    for (const r of results) {
      expect(r).toHaveProperty("templateId");
      expect(r).toHaveProperty("title");
      expect(r).toHaveProperty("description");
      expect(r).toHaveProperty("score");
      expect(r).toHaveProperty("explanation");
      expect(r).toHaveProperty("matchedTraits");
    }
  });
});

// ============================================================
// 8. V8 Migration: migration is idempotent
// ============================================================
describe("V8 Migration idempotency", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("opening DB twice does not error (idempotent migration)", () => {
    dbPath = tempDb();
    const db1 = new KaiDB(dbPath);
    db1.close();

    const db2 = new KaiDB(dbPath);
    const raw = db2.getDatabase();
    const row = raw.query("SELECT MAX(version) as v FROM schema_version").get() as { v: number };
    expect(row.v).toBeGreaterThanOrEqual(8);
    db2.close();
  });
});

// ============================================================
// 9. IdeaSubmitSchema: management domain accepted via orchestrator-schema
// ============================================================
describe("IdeaSubmitSchema accepts management domain", () => {
  test("management is a valid enum value in IdeaSubmitSchema", async () => {
    const { IdeaSubmitSchema } = await import("../src/mcp/orchestrator-schema");
    const z = (await import("zod")).z;
    const schema = z.object(IdeaSubmitSchema);
    const result = schema.safeParse({
      title: "Test",
      description: "A test idea",
      domain: "management",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe("management");
    }
  });
});

// ============================================================
// 10. InterviewEngine: no domain signal when no keywords and no domain answer
// ============================================================
describe("InterviewEngine: no false domain signals", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("answers with no domain keywords and no domain slug produce no domain signal", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [
        { slug: "goal", text: "just thinking" },
        { slug: "success", text: "feel good" },
      ],
      [],
      "ws-no-domain",
    );
    const domain = signals.find((s) => s.key === "coldstart:signal.domain");
    expect(domain).toBeUndefined();
  });
});

// ============================================================
// 11. Recommendation feedback: traitTargets propagation + confidence penalty
// ============================================================
describe("Recommendation feedback loop", () => {
  test("recommendTasks propagates traitTargets from templates", () => {
    const traits = [
      { dimension: "detail_oriented", value: 0.8, confidence: 7 },
      { dimension: "planning_style", value: 0.7, confidence: 6 },
    ];
    const recs = recommendTasks(traits, "coding");
    expect(recs.length).toBeGreaterThan(0);
    // At least one recommendation should have traitTargets
    const withTargets = recs.filter((r) => r.traitTargets && Object.keys(r.traitTargets).length > 0);
    expect(withTargets.length).toBeGreaterThan(0);
    // Verify a known template propagates its targets
    const first = withTargets[0];
    expect(first.traitTargets).toBeDefined();
    expect(typeof first.traitTargets!.detail_oriented).toBe("number");
  });

  test("confidence penalty reduces trait confidence on rejection", () => {
    const dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Test", role: "engineer" });

    // Set a high-confidence trait
    engine.setTrait({
      dimension: "detail_oriented",
      value: 0.8,
      confidence: 7,
      source: "observed",
      reasoning: "test",
    });

    // Simulate confidence penalty (mirrors work.ts logic)
    const existing = engine.getTraits({ dimension: "detail_oriented" });
    expect(existing[0].confidence).toBe(7);

    engine.setTrait({
      dimension: "detail_oriented",
      value: existing[0].value,
      confidence: Math.max(1, existing[0].confidence - 1),
      source: existing[0].source,
      reasoning: `${existing[0].reasoning} [confidence reduced: recommendation rejected]`,
    });

    const after = engine.getTraits({ dimension: "detail_oriented" });
    expect(after[0].confidence).toBe(6);
    expect(after[0].reasoning).toContain("confidence reduced");

    db.close();
    cleanup(dbPath);
  });

  test("confidence penalty floors at 1", () => {
    const dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Test", role: "engineer" });

    engine.setTrait({
      dimension: "risk_tolerance",
      value: 0.3,
      confidence: 1,
      source: "observed",
      reasoning: "already low",
    });

    const existing = engine.getTraits({ dimension: "risk_tolerance" });
    engine.setTrait({
      dimension: "risk_tolerance",
      value: existing[0].value,
      confidence: Math.max(1, existing[0].confidence - 1),
      source: existing[0].source,
      reasoning: `${existing[0].reasoning} [confidence reduced: recommendation rejected]`,
    });

    const after = engine.getTraits({ dimension: "risk_tolerance" });
    expect(after[0].confidence).toBe(1);

    db.close();
    cleanup(dbPath);
  });
});
