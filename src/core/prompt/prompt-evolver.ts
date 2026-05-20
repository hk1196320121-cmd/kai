import type { LLMProvider } from "../../llm/provider";
import type { GeneStore } from "./gene-store";
import { TournamentRunner } from "./tournament-runner";
import type { EvolutionResult, MutationType, PromptTask } from "./types";

export interface EvolutionConfig {
  task: PromptTask;
  segment_id: string;
  model: string;
  rounds?: number;
  mutant_count?: number;
  auto_approve?: boolean;
}

export interface PromotionProposal {
  task: PromptTask;
  segment_id: string;
  variant_id: string;
  model: string;
  win_rate: number;
  battle_count: number;
  needs_approval: boolean;
}

const MUTATION_TYPES: MutationType[] = ["intent_rephrase", "contract_adjust"];

export class PromptEvolver {
  private store: GeneStore;
  private tournamentRunner: TournamentRunner;

  constructor(store: GeneStore, llm: LLMProvider) {
    this.store = store;
    this.tournamentRunner = new TournamentRunner(store, llm);
  }

  async evolve(config: EvolutionConfig): Promise<EvolutionResult> {
    const evalCases = this.store.listEvalCasesByTask(config.task);
    if (evalCases.length === 0) {
      return {
        rounds_completed: 0,
        battles_run: 0,
        champion_promoted: false,
        champion_variant_id: null,
        previous_champion_variant_id: null,
      };
    }

    const genome = this.store.getGenomeByTask(config.task);
    if (!genome) {
      return {
        rounds_completed: 0,
        battles_run: 0,
        champion_promoted: false,
        champion_variant_id: null,
        previous_champion_variant_id: null,
      };
    }

    // Generate mutant variants
    const mutantCount = config.mutant_count ?? 2;
    for (let i = 0; i < mutantCount; i++) {
      const mutationType = MUTATION_TYPES[i % MUTATION_TYPES.length];
      this.generateMutation(genome.id, mutationType);
    }

    // Run tournament
    const tournamentResult = await this.tournamentRunner.run({
      task: config.task,
      segment_id: config.segment_id,
      model: config.model,
    });

    // Check for promotion
    const currentChampion = this.store.getChampion(
      config.task,
      config.segment_id,
      config.model,
    );
    const variants = this.store.listVariantsByGenome(genome.id);
    let championPromoted = false;
    let championVariantId: string | null = null;

    for (const variant of variants) {
      if (currentChampion && variant.id === currentChampion.variant_id)
        continue;
      const stats = this.store.countTournamentWins(
        variant.id,
        config.task,
        config.segment_id,
      );
      if (stats.total === 0) continue;
      const winRate = (stats.wins + stats.ties * 0.5) / stats.total;
      if (winRate >= 0.6 && stats.total >= 5) {
        if (config.auto_approve) {
          this.store.setChampion({
            task: config.task,
            segment_id: config.segment_id,
            variant_id: variant.id,
            model: config.model,
            win_rate: winRate,
            battle_count: stats.total,
            previous_variant_id: currentChampion?.variant_id ?? null,
          });
          championPromoted = true;
          championVariantId = variant.id;
        }
        break;
      }
    }

    return {
      rounds_completed: 1,
      battles_run: tournamentResult.battles_run,
      champion_promoted: championPromoted,
      champion_variant_id: championVariantId,
      previous_champion_variant_id: currentChampion?.variant_id ?? null,
    };
  }

  proposePromotion(
    task: PromptTask,
    segmentId: string,
    variantId: string,
    winRate: number,
    battleCount: number,
  ): PromotionProposal {
    return {
      task,
      segment_id: segmentId,
      variant_id: variantId,
      model: "gpt-4o-mini",
      win_rate: winRate,
      battle_count: battleCount,
      needs_approval: true,
    };
  }

  approvePromotion(proposal: PromotionProposal): void {
    this.store.setChampion({
      task: proposal.task,
      segment_id: proposal.segment_id,
      variant_id: proposal.variant_id,
      model: proposal.model,
      win_rate: proposal.win_rate,
      battle_count: proposal.battle_count,
      previous_variant_id:
        this.store.getChampion(
          proposal.task,
          proposal.segment_id,
          proposal.model,
        )?.variant_id ?? null,
    });
  }

  private generateMutation(genomeId: string, mutationType: MutationType): void {
    const genome = this.store.getGenome(genomeId);
    if (!genome) return;

    const geneIds: string[] = JSON.parse(genome.gene_ids);
    const mutatedParts: string[] = [];

    for (const geneId of geneIds) {
      const gene = this.store.getGene(geneId);
      if (!gene) continue;

      if (
        (mutationType === "intent_rephrase" && gene.type === "intent") ||
        (mutationType === "contract_adjust" && gene.type === "contract")
      ) {
        mutatedParts.push(`[Mutated ${mutationType}] ${gene.content}`);
      } else {
        mutatedParts.push(gene.content);
      }
    }

    const compiledPrompt = mutatedParts.join("\n\n");
    const existingVariants = this.store.listVariantsByGenome(genomeId);

    this.store.createVariant({
      genome_id: genomeId,
      compiled_prompt: compiledPrompt,
      generation: existingVariants.length + 1,
      mutation_type: mutationType,
    });
  }
}
