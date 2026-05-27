import type { TelemetryRecorder } from "../telemetry/recorder";
import type { DerivedTrait } from "./derivator";
import type { ProfileEngine } from "./engine";
import { RULES } from "./rules";

const VALID_LLM_DIMENSIONS = new Set(RULES.map((r) => r.dimension));

export async function deriveFromLLM(
  engine: ProfileEngine,
  telemetry: TelemetryRecorder | null,
  provider: import("../../llm/provider").LLMProvider,
  compiler?: import("../prompt/prompt-compiler").PromptCompiler,
): Promise<DerivedTrait[]> {
  const trace = telemetry?.startTrace("internal", "derive.llm");
  const span = trace?.startSpan("derivation", "LLM derivation");

  const observations = engine.getObservations();
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
Valid dimensions: scope_appetite, risk_tolerance, autonomy, early_riser, tinkerer, consistent_user, detail_oriented, planning_style, schedule_rhythm, preferred_output_shape, disliked_behavior, comm_style, domain_context, task_completion_rate.`;

  let systemPrompt: string;
  if (compiler) {
    try {
      const compiled = await compiler.compile("derivator", engine.getTraits());
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
      if (engine.isCorrected(t.dimension)) continue;
      const derived: DerivedTrait = {
        dimension: t.dimension,
        value: Math.round(Math.max(0, Math.min(1, t.value)) * 100) / 100,
        confidence: Math.max(1, Math.min(10, t.confidence)),
        source: "observed",
        reasoning: t.reasoning,
      };
      results.push(derived);
      engine.setTrait(derived);
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
