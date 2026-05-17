import { ProfileEngine } from "./engine";

interface Rule {
  dimension: string;
  match: (key: string, value: string) => boolean;
  derive: (matches: number) => { value: number; confidence: number; reasoning: string };
}

const RULES: Rule[] = [
  {
    dimension: "early_riser",
    match: (key, value) => {
      try { const v = JSON.parse(value); return v.hour !== undefined && v.hour >= 5 && v.hour <= 8; } catch { return false; }
    },
    derive: (count) => ({
      value: Math.min(1.0, count * 0.1),
      confidence: Math.min(10, count),
      reasoning: `Observed ${count} morning activities (5-8am)`,
    }),
  },
  {
    dimension: "tinkerer",
    match: (key, value) => {
      try { const v = JSON.parse(value); return v.action === "edited cron prompt"; } catch { return false; }
    },
    derive: (count) => ({
      value: Math.min(1.0, count * 0.12),
      confidence: Math.min(10, count),
      reasoning: `Edited cron prompts ${count} times`,
    }),
  },
  {
    dimension: "consistent_user",
    match: (key) => key.startsWith("cron:"),
    derive: (count) => ({
      value: Math.min(1.0, count * 0.05),
      confidence: Math.min(10, Math.floor(count / 2)),
      reasoning: `Ran ${count} cron tasks`,
    }),
  },
];

const VALID_LLM_DIMENSIONS = new Set(RULES.map((r) => r.dimension).concat([
  "scope_appetite", "risk_tolerance", "autonomy", "detail_oriented",
]));

export interface DerivedTrait {
  dimension: string;
  value: number;
  confidence: number;
  source: "observed";
  reasoning: string;
}

export class Derivator {
  private engine: ProfileEngine;

  constructor(engine: ProfileEngine) {
    this.engine = engine;
  }

  deriveFromRules(): DerivedTrait[] {
    const observations = this.engine.getObservations();
    if (observations.length === 0) return [];

    const results: DerivedTrait[] = [];

    for (const rule of RULES) {
      const matches = observations.filter((obs) => rule.match(obs.key, obs.value));
      if (matches.length > 0) {
        const derived = rule.derive(matches.length);
        const trait: DerivedTrait = {
          dimension: rule.dimension,
          value: Math.round(derived.value * 100) / 100,
          confidence: Math.max(1, derived.confidence),
          source: "observed",
          reasoning: derived.reasoning,
        };
        results.push(trait);
        this.engine.setTrait(trait);
      }
    }

    return results;
  }

  async deriveFromLLM(provider: import("../../llm/provider").LLMProvider): Promise<DerivedTrait[]> {
    const observations = this.engine.getObservations();
    if (observations.length === 0) return [];

    const prompt = JSON.stringify(observations.slice(0, 20).map((o) => ({
      type: o.type, key: o.key, value: o.value, confidence: o.confidence,
    })));

    const systemPrompt = `You are a user profile analysis engine. Given observations about a user, derive personality traits.
Return a JSON object with a "traits" array. Each trait has: dimension (string), value (0.0-1.0), confidence (1-10), reasoning (string).
Valid dimensions: scope_appetite, risk_tolerance, autonomy, early_riser, tinkerer, consistent_user, detail_oriented.`;

    try {
      const response = await provider.call(prompt, systemPrompt);
      provider.validateWithSchema(response as Record<string, unknown>, ["traits"]);

      const traits = (response as { traits: Array<{ dimension: string; value: number; confidence: number; reasoning: string }> }).traits;
      const results: DerivedTrait[] = [];
      for (const t of traits) {
        if (!VALID_LLM_DIMENSIONS.has(t.dimension)) continue;
        const derived: DerivedTrait = {
          dimension: t.dimension,
          value: Math.round(Math.max(0, Math.min(1, t.value)) * 100) / 100,
          confidence: Math.max(1, Math.min(10, t.confidence)),
          source: "observed",
          reasoning: t.reasoning,
        };
        results.push(derived);
        this.engine.setTrait(derived);
      }
      return results;
    } catch {
      return [];
    }
  }
}
