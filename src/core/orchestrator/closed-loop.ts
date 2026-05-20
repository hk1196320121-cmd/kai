import type { ProfileEngine } from "../profile/engine";
import type { OrchestratorStore } from "./store";

interface TraitChange {
  dimension: string;
  oldValue: number;
  newValue: number;
  delta: number;
  confidenceDelta: number;
}

interface ReplanThreshold {
  valueDelta: number;
  confidenceDelta: number;
  windowHours: number;
}

type TraitSnapshot = { value: number; confidence: number; updatedAt: string };

export class ClosedLoopEngine {
  private profileEngine: ProfileEngine;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: stored for future store operations
  private store: OrchestratorStore;
  private previousTraits: Map<string, TraitSnapshot>;

  constructor(profileEngine: ProfileEngine, store: OrchestratorStore) {
    this.profileEngine = profileEngine;
    this.store = store;
    this.previousTraits = this.snapshotTraits();
  }

  detectSignificantChanges(): TraitChange[] {
    const currentTraits = this.profileEngine.getTraits();
    const changes: TraitChange[] = [];
    const threshold = this.getReplanThreshold();

    for (const trait of currentTraits) {
      const prev = this.previousTraits.get(trait.dimension);
      if (!prev) continue;

      const valueDelta = Math.abs(trait.value - prev.value);
      const confDelta = Math.abs(trait.confidence - prev.confidence);

      if (
        valueDelta >= threshold.valueDelta ||
        confDelta >= threshold.confidenceDelta
      ) {
        changes.push({
          dimension: trait.dimension,
          oldValue: prev.value,
          newValue: trait.value,
          delta: valueDelta,
          confidenceDelta: confDelta,
        });
      }
    }
    return changes;
  }

  shouldTriggerReplan(): boolean {
    return this.detectSignificantChanges().length > 0;
  }

  getReplanThreshold(): ReplanThreshold {
    const prefs = this.profileEngine.getPreferences();
    const valuePref = prefs.find(
      (p) => p.key === "orchestrator.replan_threshold_value",
    );
    const confPref = prefs.find(
      (p) => p.key === "orchestrator.replan_threshold_confidence",
    );

    return {
      valueDelta: valuePref ? parseFloat(valuePref.value) : 0.15,
      confidenceDelta: confPref ? parseInt(confPref.value, 10) : 2,
      windowHours: 24,
    };
  }

  refreshSnapshot(): void {
    this.previousTraits = this.snapshotTraits();
  }

  private snapshotTraits(): Map<string, TraitSnapshot> {
    const map = new Map<string, TraitSnapshot>();
    for (const trait of this.profileEngine.getTraits()) {
      map.set(trait.dimension, {
        value: trait.value,
        confidence: trait.confidence,
        updatedAt: trait.updated_at,
      });
    }
    return map;
  }
}
