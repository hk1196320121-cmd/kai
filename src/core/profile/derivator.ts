import type { TelemetryRecorder } from "../telemetry/recorder";
import type { ProfileEngine } from "./engine";

interface Rule {
  dimension: string;
  match: (key: string, value: string) => boolean;
  derive: (matches: number) => {
    value: number;
    confidence: number;
    reasoning: string;
  };
  deriveFromValues?: (
    matches: number,
    values: string[],
  ) => {
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
    dimension: "early_riser",
    match: (key, value) => {
      if (key !== "coldstart:git.commit_time_distribution") return false;
      try {
        const v = JSON.parse(value);
        return v.morning_ratio > 0.3;
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.4 + count * 0.15),
      confidence: Math.min(10, 4 + count),
      reasoning: `Git scan: ${count} high morning commit ratio signals`,
    }),
  },
  {
    dimension: "detail_oriented",
    match: (key, value) => {
      if (key !== "coldstart:git.commit_message_length") return false;
      try {
        const v = JSON.parse(value);
        return v.detail_level === "high";
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.4 + count * 0.15),
      confidence: Math.min(10, 4 + count),
      reasoning: `Git scan: ${count} long commit message signals`,
    }),
  },
  {
    dimension: "scope_appetite",
    match: (key, value) => {
      if (key !== "coldstart:git.branch_pattern") return false;
      try {
        const v = JSON.parse(value);
        return v.structured === true;
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.3 + count * 0.2),
      confidence: Math.min(10, 3 + count),
      reasoning: `Git scan: ${count} structured branch naming signals`,
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
  {
    dimension: "planning_style",
    match: (key) => key === "coldstart:planning_style",
    derive: (count) => ({
      value: 0.5,
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} planning style signals (fallback count-based)`,
    }),
    deriveFromValues: (count, values) => {
      const answerMap: Record<string, number> = {
        "detailed plan": 0.9,
        "rough outline": 0.6,
        "dive right in": 0.2,
        "explore first": 0.4,
      };
      let total = 0;
      let matched = 0;
      const matchedAnswers: string[] = [];
      for (const v of values) {
        try {
          const parsed = JSON.parse(v);
          const answer = String(parsed.answer ?? "").toLowerCase();
          if (answerMap[answer] !== undefined) {
            total += answerMap[answer];
            matched++;
            matchedAnswers.push(answer);
          }
        } catch {
          /* skip */
        }
      }
      if (matched === 0) {
        return {
          value: 0.5,
          confidence: 3,
          reasoning: `Cold start: ${count} planning style signals (no direct match)`,
        };
      }
      return {
        value: Math.round((total / matched) * 100) / 100,
        confidence: 8,
        reasoning: `Cold start: planning style from ${matched} answer(s) [${matchedAnswers.join(", ")}], avg=${(total / matched).toFixed(2)}`,
      };
    },
  },
  {
    dimension: "schedule_rhythm",
    match: (key) => key === "coldstart:schedule_rhythm",
    derive: (count) => ({
      value: 0.5,
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} schedule rhythm signals (fallback)`,
    }),
    deriveFromValues: (count, values) => {
      const answerMap: Record<string, number> = {
        morning: 0.9,
        afternoon: 0.5,
        evening: 0.3,
        "late night": 0.2,
        flexible: 0.5,
      };
      let total = 0;
      let matched = 0;
      for (const v of values) {
        try {
          const parsed = JSON.parse(v);
          const answer = String(parsed.answer ?? "").toLowerCase();
          if (answerMap[answer] !== undefined) {
            total += answerMap[answer];
            matched++;
          }
        } catch {
          /* skip */
        }
      }
      if (matched === 0) {
        return { value: 0.5, confidence: 3, reasoning: `Cold start: ${count} schedule signals (no direct match)` };
      }
      return {
        value: Math.round((total / matched) * 100) / 100,
        confidence: 8,
        reasoning: `Cold start: schedule rhythm from ${matched} answer(s)`,
      };
    },
  },
  {
    dimension: "preferred_output_shape",
    match: (key) => key === "coldstart:preferred_output_shape",
    derive: (count) => ({
      value: 0.5,
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} output shape signals (fallback)`,
    }),
    deriveFromValues: (count, values) => {
      const answerMap: Record<string, number> = {
        checklist: 0.9,
        brief: 0.6,
        plan: 0.3,
        "decision log": 0.1,
      };
      let total = 0;
      let matched = 0;
      for (const v of values) {
        try {
          const parsed = JSON.parse(v);
          const answer = String(parsed.answer ?? "").toLowerCase();
          if (answerMap[answer] !== undefined) {
            total += answerMap[answer];
            matched++;
          }
        } catch {
          /* skip */
        }
      }
      if (matched === 0) {
        return { value: 0.5, confidence: 3, reasoning: `Cold start: ${count} output shape signals (no direct match)` };
      }
      return {
        value: Math.round((total / matched) * 100) / 100,
        confidence: 8,
        reasoning: `Cold start: output shape from ${matched} answer(s)`,
      };
    },
  },
  {
    dimension: "disliked_behavior",
    match: (key) => key === "coldstart:disliked_behavior",
    derive: (count) => ({
      value: Math.min(1.0, count * 0.3),
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} disliked behavior signals (count-based)`,
    }),
    deriveFromValues: (count, values) => {
      const patterns: Record<string, string> = {
        "acts without asking": "autonomy_violation",
        "too verbose": "verbosity",
        "too cautious": "overcaution",
        "asks too many questions": "question_overload",
        "ignores context": "context_blindness",
      };
      const detected: string[] = [];
      for (const v of values) {
        try {
          const parsed = JSON.parse(v);
          const answer = String(parsed.answer ?? "").toLowerCase();
          for (const [pattern, label] of Object.entries(patterns)) {
            if (answer.includes(pattern)) detected.push(label);
          }
        } catch {
          /* skip */
        }
      }
      if (detected.length === 0) {
        return { value: count * 0.3, confidence: 5, reasoning: `Cold start: ${count} generic disliked behavior signals` };
      }
      return {
        value: Math.min(1.0, detected.length * 0.4),
        confidence: 8,
        reasoning: `Cold start: dislikes [${detected.join(", ")}]`,
      };
    },
  },
];

const VALID_LLM_DIMENSIONS = new Set(
  RULES.map((r) => r.dimension).concat(["autonomy"]),
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
  private telemetry: TelemetryRecorder | null;

  constructor(
    engine: ProfileEngine,
    telemetry: TelemetryRecorder | null = null,
  ) {
    this.engine = engine;
    this.telemetry = telemetry;
  }

  deriveFromRules(persist: boolean = true): DerivedTrait[] {
    const trace = this.telemetry?.startTrace("internal", "derive.rules");
    const span = trace?.startSpan("derivation", "rule-based derivation");

    try {
      const observations = this.engine.getObservations();
      if (observations.length === 0) {
        span?.end("ok");
        trace?.end("completed");
        return [];
      }

      // Collect all matching observations per dimension across all rules.
      // Multiple rules can target the same dimension (e.g. detail_oriented
      // from MCP keywords and from coldstart signal). Observations from
      // all matching rules are merged so the derive function sees the
      // combined count.
      const dimMatches = new Map<
        string,
        {
          observations: typeof observations;
          derive: (typeof RULES)[number]["derive"];
          deriveFromValues?: (typeof RULES)[number]["deriveFromValues"];
        }
      >();

      for (const rule of RULES) {
        if (this.engine.isCorrected(rule.dimension)) continue;
        const matches = observations.filter((obs) =>
          rule.match(obs.key, obs.value),
        );
        if (matches.length === 0) continue;

        const existing = dimMatches.get(rule.dimension);
        if (existing) {
          existing.observations.push(...matches);
          if (rule.deriveFromValues && !existing.deriveFromValues) {
            existing.deriveFromValues = rule.deriveFromValues;
          }
        } else {
          dimMatches.set(rule.dimension, {
            observations: [...matches],
            derive: rule.derive,
            deriveFromValues: rule.deriveFromValues,
          });
        }
      }

      const results: DerivedTrait[] = [];

      for (const [dimension, { observations: obs, derive, deriveFromValues }] of dimMatches) {
        let derived: { value: number; confidence: number; reasoning: string };
        if (deriveFromValues) {
          const values = obs.map((o) => o.value);
          derived = deriveFromValues(obs.length, values);
        } else {
          derived = derive(obs.length);
        }
        const trait: DerivedTrait = {
          dimension,
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

      span?.end("ok");
      trace?.end("completed");
      return results;
    } catch (err) {
      span?.error(err as Error);
      span?.end("error");
      trace?.end("error");
      throw err;
    }
  }

  async deriveFromLLM(
    provider: import("../../llm/provider").LLMProvider,
    compiler?: import("../prompt/prompt-compiler").PromptCompiler,
  ): Promise<DerivedTrait[]> {
    const trace = this.telemetry?.startTrace("internal", "derive.llm");
    const span = trace?.startSpan("derivation", "LLM derivation");

    const observations = this.engine.getObservations();
    if (observations.length === 0) {
      span?.end("ok");
      trace?.end("completed");
      return [];
    }

    const prompt = JSON.stringify(
      observations.slice(0, 20).map((o) => ({
        type: o.type,
        key: o.key,
        value: o.value,
        confidence: o.confidence,
      })),
    );

    const DERIVATOR_FALLBACK = `You are a user profile analysis engine. Given observations about a user, derive personality traits.
Return a JSON object with a "traits" array. Each trait has: dimension (string), value (0.0-1.0), confidence (1-10), reasoning (string).
Valid dimensions: scope_appetite, risk_tolerance, autonomy, early_riser, tinkerer, consistent_user, detail_oriented.`;

    let systemPrompt: string;
    if (compiler) {
      try {
        const compiled = await compiler.compile(
          "derivator",
          this.engine.getTraits(),
        );
        systemPrompt = compiled.prompt;
      } catch (err) {
        console.error(
          "Prompt compilation failed for derivator, using fallback:",
          err,
        );
        systemPrompt = DERIVATOR_FALLBACK;
      }
    } else {
      systemPrompt = DERIVATOR_FALLBACK;
    }

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
        span?.stateChange({
          type: "trait",
          id: t.dimension,
          field: "value",
          new: t.value.toString(),
          reason: t.reasoning,
        });
      }
      span?.end("ok");
      trace?.end("completed");
      return results;
    } catch (err) {
      span?.error(err as Error);
      span?.end("error");
      trace?.end("error");
      return [];
    }
  }
}
