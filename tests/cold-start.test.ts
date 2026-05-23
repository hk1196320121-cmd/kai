import { afterEach, describe, expect, test } from "bun:test";
import { computeProfileDiff } from "../src/cli/profile";
import { scanGitHistory } from "../src/cli/work";
import { Derivator } from "../src/core/profile/derivator";
import { InterviewEngine } from "../src/core/profile/interview";
import { ProfileEngine } from "../src/core/profile/engine";
import { KaiDB } from "../src/db/client";
import { WorkspaceStore } from "../src/workspace/store";
import { cleanup, tempDb } from "./helpers/temp-db";

describe("Cold Start E2E", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("full cold start flow: identity + questions + derive + preview + diff", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    const store = new WorkspaceStore(db);

    // 1. Create identity
    engine.createIdentity({
      name: "Test User",
      role: "engineer",
    });

    // 2. Git scan
    const gitResult = scanGitHistory(process.cwd());

    // 3. Create workspace
    const ws = store.createWorkspace({ name: "E2E Test" });

    // 4. Simulate 4 answers (long enough to trigger detail_level=high for at least one)
    const answers = [
      {
        slug: "goal",
        text: "Build a comprehensive REST API for user management with authentication, role-based access control, token refresh, and session management. The system needs to support OAuth2 and SAML SSO integration with enterprise identity providers, plus a full audit log of all authentication events for compliance requirements.",
      },
      {
        slug: "success",
        text: "All endpoints tested with 90% code coverage, deployed to staging environment with zero-downtime migrations, full API documentation generated from OpenAPI spec, and load test results showing sub-200ms p99 latency at 1000 concurrent users",
      },
      {
        slug: "constraints",
        text: "Must use existing PostgreSQL database, deadline is end of sprint in 2 weeks, team of 3 developers, need to maintain backward compatibility with v1 API consumers",
      },
      { slug: "format", text: "plan" },
    ];

    // 5. Extract signals
    const signals = new InterviewEngine().extractSignalsFromAnswers(answers, gitResult.traits, ws.id);
    expect(signals.length).toBeGreaterThan(0);

    // 6. Persist observations
    for (const obs of gitResult.observations) {
      engine.addObservation(obs);
    }
    for (const obs of signals) {
      engine.addObservation(obs);
    }

    // 6b. Add initial workspace events (triggers task_completion_rate rule)
    engine.addObservation({
      type: "signal",
      key: "workspace:task_created",
      value: '{"task_id": "initial-1"}',
      confidence: 7,
      source: "workspace",
      provenance: '{"origin":"workspace_event_bus"}',
    });

    // 7. Derive in preview mode (no persist)
    const derivator = new Derivator(engine);
    const previewTraits = derivator.deriveFromRules(false);

    // Should derive at least 4 traits (comm_style, domain_context, preferred_output_shape, task_completion_rate)
    expect(previewTraits.length).toBeGreaterThanOrEqual(4);

    // 8. Confirm: persist traits
    for (const trait of previewTraits) {
      engine.setTrait(trait);
    }

    // 9. Verify traits are in DB
    const dbTraits = engine.getTraits();
    expect(dbTraits.length).toBeGreaterThanOrEqual(4);

    // 10. Check specific traits
    const dimensions = dbTraits.map((t) => t.dimension);
    expect(dimensions).toContain("comm_style");
    expect(dimensions).toContain("domain_context");

    // 11. Store snapshot
    store.updateWorkspaceContext(ws.id, {
      profile_snapshot: previewTraits.map((t) => ({
        dimension: t.dimension,
        value: t.value,
        confidence: t.confidence,
        reasoning: t.reasoning,
      })),
      coldstart_completed_at: new Date().toISOString(),
    });

    // 12. Simulate workspace events + re-derive
    engine.addObservation({
      type: "signal",
      key: "workspace:task_completed",
      value: '{"task_id": "t1"}',
      confidence: 7,
      source: "workspace",
      provenance: '{"origin":"workspace_event_bus"}',
    });
    engine.addObservation({
      type: "signal",
      key: "workspace:task_completed",
      value: '{"task_id": "t2"}',
      confidence: 7,
      source: "workspace",
      provenance: '{"origin":"workspace_event_bus"}',
    });

    derivator.deriveFromRules(true);

    // 13. Profile diff should show evolution
    const diff = computeProfileDiff(engine, store);
    expect(diff).not.toBeNull();
    if (diff) {
      const totalTraits =
        diff.changed.length + diff.stable.length + diff.newTraits.length;
      expect(totalTraits).toBeGreaterThanOrEqual(4);
    }

    db.close();
  });

  test("graceful handling of short answers", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    const answers = [
      { slug: "goal", text: "fix bug" },
      { slug: "success", text: "works" },
      { slug: "constraints", text: "none" },
      { slug: "format", text: "brief" },
    ];

    const signals = new InterviewEngine().extractSignalsFromAnswers(answers, [], "ws-test");
    for (const obs of signals) {
      engine.addObservation(obs);
    }

    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules(false);

    const commStyle = traits.find((t) => t.dimension === "comm_style");
    expect(commStyle).toBeDefined();

    db.close();
  });

  test("git scan fallback when no repo", () => {
    const result = scanGitHistory(`/tmp/does-not-exist-${Date.now()}`);
    expect(result.observations.length).toBe(0);
    expect(result.traits.length).toBe(0);
  });
});
