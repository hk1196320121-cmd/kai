import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ProfileEngine } from "../src/core/profile/engine";
import { KaiDB } from "../src/db/client";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";

describe("ProfileEngine", () => {
  let engine: ProfileEngine;
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-engine-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    engine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  describe("Identity CRUD", () => {
    test("bootstrap creates identity with defaults", () => {
      const id = engine.createIdentity({
        name: "Test User",
        role: "Developer",
      });
      expect(id).toBeTruthy();

      const identity = engine.getIdentity();
      expect(identity).not.toBeNull();
      expect(identity!.name).toBe("Test User");
      expect(identity!.role).toBe("Developer");
    });

    test("getIdentity returns null when no identity exists", () => {
      expect(engine.getIdentity()).toBeNull();
    });

    test("updateIdentity modifies specific fields", () => {
      engine.createIdentity({ name: "Test", role: "Dev" });
      engine.updateIdentity({ name: "Updated Name", goals: '["learn rust"]' });
      const identity = engine.getIdentity();
      expect(identity!.name).toBe("Updated Name");
      expect(JSON.parse(identity!.goals)).toEqual(["learn rust"]);
    });
  });

  describe("Observation CRUD", () => {
    test("addObservation writes with auto-id and timestamp", () => {
      const id = engine.addObservation({
        type: "behavior",
        key: "daily_cron_check",
        value: '{"action": "checked cron output", "frequency": 1}',
        confidence: 7,
        source: "cron_output",
        provenance: '{"origin_file": "/tmp/test-output.md", "extracted_at": "2026-01-01T00:00:00Z"}',
      });
      expect(id).toBeGreaterThan(0);
    });

    test("getObservations returns all observations", () => {
      engine.addObservation({ type: "behavior", key: "a", value: '{}', confidence: 5, source: "cron_output", provenance: '{}' });
      engine.addObservation({ type: "feedback", key: "b", value: '{}', confidence: 8, source: "user_stated", provenance: '{}' });
      const obs = engine.getObservations();
      expect(obs.length).toBe(2);
    });

    test("getObservations filters by type", () => {
      engine.addObservation({ type: "behavior", key: "a", value: '{}', confidence: 5, source: "cron_output", provenance: '{}' });
      engine.addObservation({ type: "feedback", key: "b", value: '{}', confidence: 8, source: "user_stated", provenance: '{}' });
      const behavior = engine.getObservations({ type: "behavior" });
      expect(behavior.length).toBe(1);
      expect(behavior[0].type).toBe("behavior");
    });

    test("getObservations filters by date range", () => {
      engine.addObservation({ type: "behavior", key: "old", value: '{}', confidence: 5, source: "cron_output", provenance: '{}' });
      const recent = engine.getObservations({ since: new Date(Date.now() + 10000).toISOString() });
      expect(recent.length).toBe(0);
    });

    test("getBehaviorObservations returns typed results", () => {
      engine.addObservation({
        type: "behavior",
        key: "cron_check",
        value: '{"action": "checked cron", "frequency": 3, "context": "morning routine"}',
        confidence: 7,
        source: "cron_output",
        provenance: '{}',
      });
      const behaviors = engine.getBehaviorObservations();
      expect(behaviors.length).toBe(1);
      expect(behaviors[0].action).toBe("checked cron");
      expect(behaviors[0].frequency).toBe(3);
    });

    test("getBehaviorObservations returns empty for invalid JSON value", () => {
      engine.addObservation({ type: "behavior", key: "bad", value: 'not json', confidence: 5, source: "cron_output", provenance: '{}' });
      const behaviors = engine.getBehaviorObservations();
      expect(behaviors).toEqual([]);
    });
  });

  describe("Trait CRUD", () => {
    test("setTrait upserts by dimension", () => {
      engine.setTrait({
        dimension: "scope_appetite",
        value: 0.8,
        confidence: 7,
        source: "observed",
        reasoning: "User frequently starts large projects",
      });
      const traits = engine.getTraits();
      expect(traits.length).toBe(1);
      expect(traits[0].dimension).toBe("scope_appetite");
      expect(traits[0].value).toBeCloseTo(0.8);
    });

    test("setTrait updates existing dimension", () => {
      engine.setTrait({ dimension: "autonomy", value: 0.5, confidence: 3, source: "observed", reasoning: "initial" });
      engine.setTrait({ dimension: "autonomy", value: 0.7, confidence: 6, source: "observed", reasoning: "updated" });
      const traits = engine.getTraits();
      expect(traits.length).toBe(1);
      expect(traits[0].value).toBeCloseTo(0.7);
      expect(traits[0].confidence).toBe(6);
    });

    test("getTraits filters by dimension", () => {
      engine.setTrait({ dimension: "a", value: 0.5, confidence: 3, source: "observed", reasoning: "test" });
      engine.setTrait({ dimension: "b", value: 0.8, confidence: 5, source: "inferred", reasoning: "test" });
      const filtered = engine.getTraits({ dimension: "a" });
      expect(filtered.length).toBe(1);
      expect(filtered[0].dimension).toBe("a");
    });
  });

  describe("removeTrait", () => {
    test("removeTrait deletes a trait by dimension", () => {
      engine.setTrait({ dimension: "to_remove", value: 0.5, confidence: 3, source: "observed", reasoning: "test" });
      expect(engine.getTraits({ dimension: "to_remove" }).length).toBe(1);
      const removed = engine.removeTrait("to_remove");
      expect(removed).toBe(true);
      expect(engine.getTraits({ dimension: "to_remove" }).length).toBe(0);
    });

    test("removeTrait returns false for unknown dimension", () => {
      expect(engine.removeTrait("nonexistent")).toBe(false);
    });
  });

  describe("Preference CRUD", () => {
    test("setPreference upserts by key", () => {
      engine.setPreference({ key: "interaction_level", value: "2", source: "user-stated" });
      const prefs = engine.getPreferences();
      expect(prefs.length).toBe(1);
      expect(prefs[0].key).toBe("interaction_level");
    });

    test("setPreference updates existing key", () => {
      engine.setPreference({ key: "level", value: "1", source: "inferred" });
      engine.setPreference({ key: "level", value: "3", source: "user-stated" });
      const prefs = engine.getPreferences();
      expect(prefs.length).toBe(1);
      expect(prefs[0].value).toBe("3");
    });
  });

  describe("Profile Snapshot", () => {
    test("getProfile returns complete snapshot", () => {
      engine.createIdentity({ name: "Test", role: "Dev" });
      engine.addObservation({ type: "behavior", key: "x", value: '{}', confidence: 5, source: "cron_output", provenance: '{}' });
      engine.setTrait({ dimension: "test", value: 0.5, confidence: 3, source: "observed", reasoning: "test" });

      const snapshot = engine.getProfile();
      expect(snapshot.identity).not.toBeNull();
      expect(snapshot.traits.length).toBe(1);
      expect(snapshot.observationCount).toBe(1);
    });

    test("getProfile returns null identity when not bootstrapped", () => {
      const snapshot = engine.getProfile();
      expect(snapshot.identity).toBeNull();
      expect(snapshot.observationCount).toBe(0);
    });
  });
});
