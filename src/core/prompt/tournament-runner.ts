import type { LLMProvider } from "../../llm/provider";
import type { TelemetryRecorder } from "../telemetry/recorder";
import type { GeneStore } from "./gene-store";
import { JudgeEngine } from "./judge-engine";
import type { PromptTask } from "./types";

export interface TournamentConfig {
  task: PromptTask;
  segment_id: string;
  model: string;
  sample_size?: number;
  max_variants?: number;
}

export interface TournamentRunResult {
  battles_run: number;
  tournaments: string[];
  error?: string;
}

const MAX_VARIANTS = 10;
const DEFAULT_SAMPLE_SIZE = 10;

export class TournamentRunner {
  private store: GeneStore;
  private judge: JudgeEngine;
  private llm: LLMProvider;
  private telemetry: TelemetryRecorder | null;

  constructor(
    store: GeneStore,
    llm: LLMProvider,
    telemetry: TelemetryRecorder | null = null,
  ) {
    this.store = store;
    this.llm = llm;
    this.telemetry = telemetry;
    this.judge = new JudgeEngine(llm);
  }

  async run(config: TournamentConfig): Promise<TournamentRunResult> {
    const trace = this.telemetry?.startTrace("internal", "tournament.run");
    const span = trace?.startSpan("genome_evolve", "prompt tournament");

    const evalCases = this.store.listEvalCasesByTask(config.task);
    if (evalCases.length === 0) {
      span?.end("ok");
      trace?.end("completed");
      return {
        battles_run: 0,
        tournaments: [],
        error: "no eval cases in pool",
      };
    }

    const genome = this.store.getGenomeByTask(config.task);
    if (!genome) {
      span?.end("ok");
      trace?.end("completed");
      return { battles_run: 0, tournaments: [], error: "no genome found" };
    }

    const allVariants = this.store.listVariantsByGenome(genome.id);
    const maxVariants = config.max_variants ?? MAX_VARIANTS;
    const variants = allVariants.slice(-maxVariants);
    if (variants.length < 2) {
      span?.end("ok");
      trace?.end("completed");
      return {
        battles_run: 0,
        tournaments: [],
        error: "need at least 2 variants",
      };
    }

    const sampleSize =
      config.sample_size ?? Math.min(DEFAULT_SAMPLE_SIZE, evalCases.length);
    const sampledCases = evalCases.slice(0, sampleSize);

    const tournamentIds: string[] = [];
    let battlesRun = 0;

    for (let i = 0; i < variants.length; i++) {
      for (let j = i + 1; j < variants.length; j++) {
        const variantA = variants[i];
        const variantB = variants[j];

        for (const evalCase of sampledCases) {
          const tournament = this.store.createTournament({
            task: config.task,
            variant_a_id: variantA.id,
            variant_b_id: variantB.id,
            eval_case_id: evalCase.id,
            segment_id: config.segment_id,
            model: config.model,
          });

          try {
            // Generate outputs from each variant prompt, then compare
            const [outputA, outputB] = await Promise.all([
              this.llm.call(evalCase.input, variantA.compiled_prompt),
              this.llm.call(evalCase.input, variantB.compiled_prompt),
            ]);

            const result = await this.judge.majorityVote(
              JSON.stringify(outputA),
              JSON.stringify(outputB),
              evalCase.input,
            );

            this.store.updateTournamentResult(
              tournament.id,
              result.winner,
              result.reasoning,
              result.confidence,
            );
            battlesRun++;
          } catch {
            // Judge failed for this battle — leave result null
          }

          tournamentIds.push(tournament.id);
        }
      }
    }

    span?.end("ok");
    trace?.end("completed");
    return { battles_run: battlesRun, tournaments: tournamentIds };
  }
}
