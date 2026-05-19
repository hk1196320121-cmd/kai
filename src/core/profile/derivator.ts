import type { ProfileEngine } from "./engine";

interface Rule {
  dimension: string;
  match: (key: string, value: string) => boolean;
  derive: (matches: number) => {
    value: number;
    confidence: number;
    reasoning: string;
  };
}

export const RULES: Rule[] = [
  {
    dimension: "early_riser",
    match: (_key, value) => {
      try {
        const v = JSON.parse(value);
        return v.hour !== undefined && v.hour >= 5 && v.hour <= 8;
      } catch {
        return false;
      }
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
      try {
        const v = JSON.parse(value);
        const isActivityKey = key.startsWith("cron:") || key.startsWith("mcp:");
        return (
          isActivityKey &&
          typeof v.contentLength === "number" &&
          v.contentLength > 0
        );
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, count * 0.12),
      confidence: Math.min(10, count),
      reasoning: `Has ${count} distinct cron output entries (frequent task tinkerer)`,
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
  {
    dimension: "detail_oriented",
    match: (key, value) => {
      if (!key.startsWith("mcp:")) return false;
      try {
        const v = JSON.parse(value);
        const text = (v.text ?? "").toLowerCase();
        return (
          text.includes("detail") ||
          text.includes("thorough") ||
          text.includes("exhaustive") ||
          text.includes("careful")
        );
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.3 + count * 0.15),
      confidence: Math.min(10, 3 + count),
      reasoning: `MCP observation suggests detail orientation (${count} signals)`,
    }),
  },
  {
    dimension: "scope_appetite",
    match: (key, value) => {
      if (!key.startsWith("mcp:")) return false;
      try {
        const v = JSON.parse(value);
        const text = (v.text ?? "").toLowerCase();
        return (
          text.includes("ambitious") ||
          text.includes("big project") ||
          text.includes("scope") ||
          text.includes("large")
        );
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.3 + count * 0.2),
      confidence: Math.min(10, 2 + count),
      reasoning: `MCP observation suggests large scope appetite (${count} signals)`,
    }),
  },
  {
    dimension: "risk_tolerance",
    match: (key, value) => {
      if (!key.startsWith("mcp:")) return false;
      try {
        const v = JSON.parse(value);
        const text = (v.text ?? "").toLowerCase();
        return (
          text.includes("risk") ||
          text.includes("experiment") ||
          text.includes("try new") ||
          text.includes("cutting edge")
        );
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.3 + count * 0.2),
      confidence: Math.min(10, 2 + count),
      reasoning: `MCP observation suggests risk tolerance (${count} signals)`,
    }),
  },
  {
    dimension: "detail_oriented",
    match: (key, value) => {
      if (key !== "coldstart:signal.detail_level") return false;
      try {
        const v = JSON.parse(value);
        return v.level === "high";
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.5 + count * 0.15),
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} high-detail signals detected`,
    }),
  },
  {
    dimension: "comm_style",
    match: (key) => key === "coldstart:signal.comm_style",
    derive: (count) => ({
      value: Math.min(1.0, count * 0.2),
      confidence: Math.min(10, 3 + count * 2),
      reasoning: `Cold start: ${count} communication style signals`,
    }),
  },
  {
    dimension: "domain_context",
    match: (key) => key === "coldstart:signal.domain",
    derive: (count) => ({
      value: Math.min(1.0, count * 0.25),
      confidence: Math.min(10, 4 + count * 2),
      reasoning: `Cold start: ${count} domain context signals`,
    }),
  },
  {
    dimension: "preferred_output_shape",
    match: (key) => key === "coldstart:format",
    derive: (count) => ({
      value: Math.min(1.0, count * 0.3),
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} output format preferences`,
    }),
  },
  {
    dimension: "task_completion_rate",
    match: (key) => key.startsWith("workspace:task_"),
    derive: (count) => ({
      value: Math.min(1.0, count * 0.15),
      confidence: Math.min(10, count),
      reasoning: `${count} workspace task events recorded`,
    }),
  },
];

const VALID_LLM_DIMENSIONS = new Set(
  RULES.map((r) => r.dimension).concat(["autonomy", "planning_style"]),
);

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

  deriveFromRules(persist: boolean = true): DerivedTrait[] {
    const observations = this.engine.getObservations();
    if (observations.length === 0) return [];

    const results: DerivedTrait[] = [];

    for (const rule of RULES) {
      if (this.engine.isCorrected(rule.dimension)) continue;
      const matches = observations.filter((obs) =>
        rule.match(obs.key, obs.value),
      );
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
        if (persist) {
          this.engine.setTrait(trait);
        }
      }
    }

    return results;
  }

  async deriveFromLLM(
    provider: import("../../llm/provider").LLMProvider,
  ): Promise<DerivedTrait[]> {
    const observations = this.engine.getObservations();
    if (observations.length === 0) return [];

    const prompt = JSON.stringify(
      observations.slice(0, 20).map((o) => ({
        type: o.type,
        key: o.key,
        value: o.value,
        confidence: o.confidence,
      })),
    );

    const systemPrompt = `You are a user profile analysis engine. Given observations about a user, derive personality traits.
Return a JSON object with a "traits" array. Each trait has: dimension (string), value (0.0-1.0), confidence (1-10), reasoning (string).
Valid dimensions: scope_appetite, risk_tolerance, autonomy, early_riser, tinkerer, consistent_user, detail_oriented.`;

    try {
      const response = await provider.call(prompt, systemPrompt);
      provider.validateWithSchema(response as Record<string, unknown>, [
        "traits",
      ]);

      const traits = (
        response as {
          traits: Array<{
            dimension: string;
            value: number;
            confidence: number;
            reasoning: string;
          }>;
        }
      ).traits;
      const results: DerivedTrait[] = [];
      for (const t of traits) {
        if (!VALID_LLM_DIMENSIONS.has(t.dimension)) continue;
        if (this.engine.isCorrected(t.dimension)) continue;
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
