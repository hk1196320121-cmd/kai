import type { ProfileEngine } from "./engine";
import type { Observation, ProvenanceChain } from "./types";

export interface TraitExplanation {
  dimension: string;
  traitValue: number;
  traitConfidence: number;
  traitSource: string;
  traitReasoning: string;
  relatedObservations: Observation[];
}

export class ProvenanceEngine {
  private engine: ProfileEngine;

  constructor(engine: ProfileEngine) {
    this.engine = engine;
  }

  why(dimension: string): TraitExplanation | null {
    const traits = this.engine.getTraits({ dimension });
    if (traits.length === 0) return null;
    const trait = traits[0];

    const allObs = this.engine.getObservations();
    const relatedObs = allObs.filter((obs) => {
      if (obs.key.includes(dimension)) return true;
      try {
        const prov = JSON.parse(obs.provenance) as Record<string, unknown>;
        if (
          Array.isArray(prov.related_traits) &&
          prov.related_traits.includes(dimension)
        )
          return true;
        if (
          obs.type === "signal" &&
          obs.key.startsWith("mcp:") &&
          obs.value.includes(dimension)
        )
          return true;
        return false;
      } catch {
        return false;
      }
    });

    const behaviorObs = allObs
      .filter((obs) => obs.type === "behavior")
      .slice(0, 5);
    const combined = [
      ...new Map(
        [...relatedObs, ...behaviorObs].map((o) => [o.id, o]),
      ).values(),
    ];

    return {
      dimension: trait.dimension,
      traitValue: trait.value,
      traitConfidence: trait.confidence,
      traitSource: trait.source,
      traitReasoning: trait.reasoning,
      relatedObservations: combined,
    };
  }

  correct(dimension: string, reason: string): boolean {
    const traits = this.engine.getTraits({ dimension });
    if (traits.length === 0) return false;

    this.engine.addObservation({
      type: "feedback",
      key: `correction:${dimension}`,
      value: JSON.stringify({
        corrected_trait: dimension,
        reason,
        previous_value: traits[0].value,
      }),
      confidence: 10,
      source: "user_stated",
      provenance: JSON.stringify({
        correction: true,
        corrected_at: new Date().toISOString(),
      }),
    });

    this.engine.addCorrection(dimension, reason);
    return this.engine.removeTrait(dimension);
  }

  getProvenanceChain(observationId: number): ProvenanceChain | null {
    const observation = this.engine.getObservationById(observationId);
    if (!observation) return null;

    try {
      const prov = JSON.parse(observation.provenance) as Record<string, string>;
      return {
        observationId: observation.id,
        originFile: prov.origin_file ?? "unknown",
        extractedAt: prov.extracted_at ?? observation.ts,
        extractorVersion: prov.extractor_version ?? "unknown",
        relatedTraits: [],
      };
    } catch {
      return {
        observationId: observation.id,
        originFile: "unknown",
        extractedAt: observation.ts,
        extractorVersion: "unknown",
        relatedTraits: [],
      };
    }
  }
}
