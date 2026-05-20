import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KaiDB } from "../../../src/db/client";
import { OrchestratorStore } from "../../../src/core/orchestrator/store";
import { ProfileEngine } from "../../../src/core/profile/engine";
import { IdeaClusterer, STOP_WORDS } from "../../../src/core/orchestrator/clustering";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("IdeaClusterer", () => {
  let db: KaiDB;
  let store: OrchestratorStore;
  let profileEngine: ProfileEngine;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-cluster-${Date.now()}.db`);
    db = new KaiDB(dbPath);
    store = new OrchestratorStore(db);
    profileEngine = new ProfileEngine(db);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("STOP_WORDS contains common English words", () => {
    expect(STOP_WORDS.has("the")).toBe(true);
    expect(STOP_WORDS.has("and")).toBe(true);
    expect(STOP_WORDS.has("rust")).toBe(false);
  });

  test("detectClusters returns empty when no observations", () => {
    const clusterer = new IdeaClusterer(profileEngine, store);
    const clusters = clusterer.detectClusters();
    expect(clusters).toHaveLength(0);
  });

  test("detectClusters finds recurring theme in observations", () => {
    const clusterer = new IdeaClusterer(profileEngine, store);
    profileEngine.addObservation({ type: "signal", key: "test:1", value: JSON.stringify({ text: "I want to learn Rust programming" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:2", value: JSON.stringify({ text: "Rust is interesting for systems programming" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:3", value: JSON.stringify({ text: "Thinking about Rust CLI tools" }), confidence: 5, source: "mcp", provenance: "{}" });

    const clusters = clusterer.detectClusters();
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const rustCluster = clusters.find((c) => c.theme.toLowerCase().includes("rust"));
    expect(rustCluster).toBeDefined();
    expect(rustCluster!.count).toBeGreaterThanOrEqual(3);
  });

  test("detectClusters skips themes that already have an idea", () => {
    const clusterer = new IdeaClusterer(profileEngine, store);
    store.createIdea({ title: "Learn Rust", description: "Rust programming", domain: "coding", priority: "medium", workspace_id: "ws-1" });
    profileEngine.addObservation({ type: "signal", key: "test:1", value: JSON.stringify({ text: "I want to learn Rust" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:2", value: JSON.stringify({ text: "Rust is great" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:3", value: JSON.stringify({ text: "Rust CLI tools" }), confidence: 5, source: "mcp", provenance: "{}" });

    const clusters = clusterer.detectClusters();
    const rustCluster = clusters.find((c) => c.theme.toLowerCase().includes("rust"));
    expect(rustCluster).toBeUndefined();
  });

  test("detectClusters filters stop words", () => {
    const clusterer = new IdeaClusterer(profileEngine, store);
    profileEngine.addObservation({ type: "signal", key: "test:1", value: JSON.stringify({ text: "the and but or" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:2", value: JSON.stringify({ text: "the and but or" }), confidence: 5, source: "mcp", provenance: "{}" });
    profileEngine.addObservation({ type: "signal", key: "test:3", value: JSON.stringify({ text: "the and but or" }), confidence: 5, source: "mcp", provenance: "{}" });

    const clusters = clusterer.detectClusters();
    expect(clusters).toHaveLength(0);
  });
});
