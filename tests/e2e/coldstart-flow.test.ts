import { describe, test, expect, afterEach } from "bun:test";
import { InterviewEngine } from "../../src/core/profile/interview";
import { Derivator } from "../../src/core/profile/derivator";
import { ProfileEngine } from "../../src/core/profile/engine";
import { recommendTasks } from "../../src/core/orchestrator/recommend";
import { OrchestratorStore } from "../../src/core/orchestrator/store";
import { WorkspaceStore } from "../../src/workspace/store";
import { KaiDB } from "../../src/db/client";
import { cleanup, tempDb } from "../helpers/temp-db";

describe("E2E: Cold Start Flow", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("complete cold start: identity -> interview -> derive -> recommend -> idea -> dispatch", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    const workspaceStore = new WorkspaceStore(db);
    const orchStore = new OrchestratorStore(db);

    // 1. Create identity
    engine.createIdentity({ name: "Alice", role: "senior engineer" });
    expect(engine.getIdentity()).toBeDefined();

    // 2. Create workspace
    const ws = workspaceStore.createWorkspace({
      name: "Cold Start E2E",
      description: "E2E test workspace",
    });

    // 3. Interview: 10 answers
    const answers = [
      { slug: "goal", text: "Build a microservice for email notifications" },
      { slug: "success", text: "Send 10k emails/hour with <100ms latency, 99.9% delivery rate" },
      { slug: "constraints", text: "Must integrate with existing Kafka pipeline, 3-week deadline" },
      { slug: "domain", text: "engineering" },
      { slug: "planning_style", text: "detailed plan" },
      { slug: "schedule_rhythm", text: "morning" },
      { slug: "preferred_output_shape", text: "checklist" },
      { slug: "risk_tolerance", text: "after basic testing" },
      { slug: "autonomy", text: "suggest only" },
      { slug: "disliked_behavior", text: "acts without asking" },
    ];

    const interview = new InterviewEngine();
    const signals = interview.extractSignalsFromAnswers(answers, [], ws.id);
    expect(signals.length).toBeGreaterThan(5);

    for (const obs of signals) {
      engine.addObservation(obs);
    }

    // 4. Derive traits
    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules();
    expect(traits.length).toBeGreaterThan(3);

    // 5. Verify new dimensions
    expect(traits.find((t) => t.dimension === "planning_style")?.value).toBe(0.9);
    expect(traits.find((t) => t.dimension === "schedule_rhythm")?.value).toBe(0.9);
    expect(traits.find((t) => t.dimension === "preferred_output_shape")?.value).toBe(0.9);

    // 6. Recommend
    const savedTraits = engine.getTraits();
    const recommendations = recommendTasks(savedTraits, "coding");
    expect(recommendations.length).toBe(3);
    expect(recommendations[0].score).toBeGreaterThan(0);

    // 7. Create idea from recommendation (simulating auto-execute)
    const idea = orchStore.createIdea({
      title: recommendations[0].title,
      description: recommendations[0].description,
      domain: "coding",
      workspace_id: ws.id,
    });
    expect(idea.id).toBeDefined();
    expect(idea.status).toBe("draft");

    // 8. Log events
    workspaceStore.addEvent({
      workspace_id: ws.id,
      event_type: "recommendation_shown",
      payload: JSON.stringify({ recommendations: recommendations.map((r) => r.templateId) }),
    });
    workspaceStore.addEvent({
      workspace_id: ws.id,
      event_type: "recommendation_accepted",
      payload: JSON.stringify({ template_id: recommendations[0].templateId }),
    });
    workspaceStore.addEvent({
      workspace_id: ws.id,
      event_type: "task_auto_executed",
      payload: JSON.stringify({ idea_id: idea.id }),
    });

    // 9. Verify events persisted
    const events = workspaceStore.getEventCountsByWorkspaces([ws.id]);
    expect(events.get(ws.id)).toBe(3);

    db.close();
  });

  test("re-run detection: skip interview when coldstart data exists", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.createIdentity({ name: "Bob", role: "dev" });
    engine.addObservation({
      type: "signal",
      key: "coldstart:goal",
      value: JSON.stringify({ answer: "Build something" }),
      confidence: 8,
      source: "coldstart",
      provenance: "{}",
    });

    // Re-run detection
    const existingColdstart = engine
      .getObservations({ type: "signal" })
      .filter((o) => o.source === "coldstart");
    expect(existingColdstart.length).toBeGreaterThan(0);

    // Should skip interview and go straight to recommendations
    const derivator = new Derivator(engine);
    derivator.deriveFromRules();
    const traits = engine.getTraits();
    const recommendations = recommendTasks(traits, "general");
    expect(recommendations.length).toBe(3);

    db.close();
  });
});
