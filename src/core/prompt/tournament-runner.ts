import type { LLMProvider } from "../../llm/provider";
import type { GeneStore } from "./gene-store";
import { JudgeEngine } from "./judge-engine";
import type { PromptTask } from "./types";

export interface TournamentConfig {
  task: PromptTask;
  segment_id: string;
  model: string;
  sample_size?: number;
}

export interface TournamentRunResult {
  battles_run: number;
  tournaments: string[];
  error?: string;
}

export class TournamentRunner {
  private store: GeneStore;
  private judge: JudgeEngine;

  constructor(store: GeneStore, llm: LLMProvider) {
    this.store = store;
    this.judge = new JudgeEngine(llm);
  }

  async run(config: TournamentConfig): Promise<TournamentRunResult> {
    const evalCases = this.store.listEvalCasesByTask(config.task);
    if (evalCases.length === 0) {
      return {
        battles_run: 0,
        tournaments: [],
        error: "no eval cases in pool",
      };
    }

    const genome = this.store.getGenomeByTask(config.task);
    if (!genome) {
      return { battles_run: 0, tournaments: [], error: "no genome found" };
    }

    const variants = this.store.listVariantsByGenome(genome.id);
    if (variants.length < 2) {
      return {
        battles_run: 0,
        tournaments: [],
        error: "need at least 2 variants",
      };
    }

    const sampleSize = config.sample_size ?? Math.min(10, evalCases.length);
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
            const result = await this.judge.majorityVote(
              variantA.compiled_prompt,
              variantB.compiled_prompt,
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

    return { battles_run: battlesRun, tournaments: tournamentIds };
  }
}
