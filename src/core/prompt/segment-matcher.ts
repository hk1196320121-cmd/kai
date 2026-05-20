import type { Trait } from "../profile/types";
import type { GeneStore } from "./gene-store";
import type { SegmentMatch } from "./types";

const MIN_HIGH_CONFIDENCE_TRAITS = 3;
const MIN_CONFIDENCE_THRESHOLD = 5;

export class SegmentMatcher {
  private store: GeneStore;

  constructor(store: GeneStore) {
    this.store = store;
  }

  match(traits: Trait[]): SegmentMatch {
    const highConfidenceTraits = traits.filter(
      (t) => t.confidence >= MIN_CONFIDENCE_THRESHOLD,
    );

    if (highConfidenceTraits.length < MIN_HIGH_CONFIDENCE_TRAITS) {
      return {
        segment_id: "default",
        segment_name: "default",
        constraints_satisfied: 0,
        is_default: true,
      };
    }

    const traitMap = new Map(
      highConfidenceTraits.map((t) => [t.dimension, t.value]),
    );
    const segments = this.store.listSegments();

    let bestMatch: SegmentMatch = {
      segment_id: "default",
      segment_name: "default",
      constraints_satisfied: 0,
      is_default: true,
    };

    for (const segment of segments) {
      if (segment.id === "default") continue;

      const constraints = JSON.parse(segment.trait_constraints) as Record<
        string,
        { min?: number; max?: number }
      >;
      let satisfied = 0;
      let allSatisfied = true;

      for (const [dimension, constraint] of Object.entries(constraints)) {
        const value = traitMap.get(dimension);
        if (value === undefined) {
          allSatisfied = false;
          continue;
        }
        if (constraint.min !== undefined && value < constraint.min) {
          allSatisfied = false;
        }
        if (constraint.max !== undefined && value > constraint.max) {
          allSatisfied = false;
        }
        if (
          (constraint.min !== undefined && value >= constraint.min) ||
          (constraint.max !== undefined && value <= constraint.max)
        ) {
          satisfied++;
        }
      }

      if (allSatisfied && satisfied > bestMatch.constraints_satisfied) {
        bestMatch = {
          segment_id: segment.id,
          segment_name: segment.name,
          constraints_satisfied: satisfied,
          is_default: false,
        };
      }
    }

    return bestMatch;
  }
}
