import { ProfileEngine } from "./engine";

export interface DecayResult {
  decayed: number;
  skipped: number;
}

export class DecayEngine {
  private engine: ProfileEngine;
  private readonly MIN_CONFIDENCE = 1;
  private readonly DECAY_AMOUNT = 1;

  constructor(engine: ProfileEngine) {
    this.engine = engine;
  }

  apply(): DecayResult {
    const traits = this.engine.getTraits();
    let decayed = 0;
    let skipped = 0;

    for (const trait of traits) {
      if (trait.source === "declared") {
        skipped++;
        continue;
      }

      if (trait.confidence <= this.MIN_CONFIDENCE) {
        skipped++;
        continue;
      }

      const newConfidence = Math.max(this.MIN_CONFIDENCE, trait.confidence - this.DECAY_AMOUNT);
      this.engine.setTrait({
        dimension: trait.dimension,
        value: trait.value,
        confidence: newConfidence,
        source: trait.source,
        reasoning: trait.reasoning.replace(/; decayed(\s*\d{4}-\d{2}-\d{2})?$/, "") + `; decayed ${new Date().toISOString().slice(0, 10)}`,
      });
      decayed++;
    }

    return { decayed, skipped };
  }
}
