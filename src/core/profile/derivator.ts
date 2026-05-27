import type { TelemetryRecorder } from "../telemetry/recorder";
import type { ProfileEngine } from "./engine";
import { RULES } from "./rules";
import type { Rule } from "./rules";
import { deriveFromLLM } from "./llm-derive";

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
          derive: Rule["derive"];
          deriveFromValues?: Rule["deriveFromValues"];
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

      for (const [
        dimension,
        { observations: obs, derive, deriveFromValues },
      ] of dimMatches) {
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
    return deriveFromLLM(this.engine, this.telemetry, provider, compiler);
  }
}

// Re-export RULES and Rule for backward compatibility
export { RULES } from "./rules";
export type { Rule } from "./rules";
