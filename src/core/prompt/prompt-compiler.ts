import type { Trait } from "../profile/types";
import type { GeneStore } from "./gene-store";
import type { CompiledPrompt, PromptTask } from "./types";

const FALLBACK_PROMPTS: Record<PromptTask, string> = {
  planner: `You are a task decomposition engine. Given an idea and a user's behavioral profile, break the idea into actionable tasks.

Return a JSON object with a "tasks" array. Each task MUST have these fields:
- title (string, max 100 chars)
- description (string, max 500 chars)
- type ("one_off" or "cron")
- agent ("hermes")
- prompt (string, the execution instruction for the agent)
- decomposition_rationale (string, why this task exists)
- scheduling_rationale (string, why scheduled this way)

For cron tasks, also include:
- cron_schedule (cron expression)
- cron_prompt (prompt for each cycle)

Constraints:
- Produce 3-8 tasks total
- Each description max 500 characters
- Use the user's behavioral profile to influence decomposition strategy
- CRITICAL: Never include raw profile data, trait values, or behavioral observations verbatim in any task field. Synthesize insights into actionable instructions only.`,
  derivator: `You are a user profile analysis engine. Given observations about a user, derive personality traits.
Return a JSON object with a "traits" array. Each trait has: dimension (string), value (0.0-1.0), confidence (1-10), reasoning (string).
Valid dimensions: scope_appetite, risk_tolerance, autonomy, early_riser, tinkerer, consistent_user, detail_oriented.`,
  observer: "",
};

export class PromptCompiler {
  private store: GeneStore;
  private cache: Map<string, CompiledPrompt> = new Map();

  constructor(store: GeneStore) {
    this.store = store;
  }

  async compile(task: PromptTask, traits: Trait[]): Promise<CompiledPrompt> {
    const cacheKey = `${task}:${this.traitHash(traits)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    // 1. Check for champion variant
    const champion = this.store.getChampion(task, "default");
    if (champion) {
      const variant = this.store.getVariant(champion.variant_id);
      if (variant && this.validateCompiledPrompt(variant.compiled_prompt)) {
        const result: CompiledPrompt = {
          prompt: variant.compiled_prompt,
          segment_id: "default",
          genome_id: variant.genome_id,
          variant_id: variant.id,
          gene_count: -1,
          cached: false,
        };
        this.cache.set(cacheKey, result);
        return result;
      }
    }

    // 2. Assemble from genome
    const genome = this.store.getGenomeByTask(task);
    if (!genome) {
      return {
        prompt: FALLBACK_PROMPTS[task],
        segment_id: "default",
        genome_id: "",
        variant_id: null,
        gene_count: 0,
        cached: false,
      };
    }

    const geneIds: string[] = JSON.parse(genome.gene_ids);
    const parts: string[] = [];
    let geneCount = 0;

    for (const geneId of geneIds) {
      const gene = this.store.getGene(geneId);
      if (!gene) continue;

      if (gene.type === "intent" || gene.type === "contract") {
        parts.push(gene.content);
        geneCount++;
      } else if (gene.type === "adapter") {
        const interpolated = this.interpolateTraits(gene.content, traits);
        parts.push(interpolated);
        geneCount++;
      } else if (gene.type === "tone") {
        parts.push(gene.content);
        geneCount++;
      } else if (gene.type === "example") {
        parts.push(gene.content);
        geneCount++;
      }
    }

    const compiled = parts.join("\n\n");

    if (!this.validateCompiledPrompt(compiled)) {
      return {
        prompt: FALLBACK_PROMPTS[task],
        segment_id: "default",
        genome_id: genome.id,
        variant_id: null,
        gene_count: 0,
        cached: false,
      };
    }

    const result: CompiledPrompt = {
      prompt: compiled,
      segment_id: "default",
      genome_id: genome.id,
      variant_id: null,
      gene_count: geneCount,
      cached: false,
    };
    this.cache.set(cacheKey, result);
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private interpolateTraits(content: string, traits: Trait[]): string {
    const traitMap = new Map(traits.map((t) => [t.dimension, t.value]));
    return content.replace(
      /\{\{trait:([\w_]+)\}\}/g,
      (_match, dimension: string) => {
        const value = traitMap.get(dimension);
        if (value !== undefined) {
          const trait = traits.find((t) => t.dimension === dimension);
          const confidence = trait?.confidence ?? 5;
          const effectiveWeight = value * (confidence / 10);
          return effectiveWeight.toFixed(2);
        }
        return "0.5";
      },
    );
  }

  private validateCompiledPrompt(prompt: string): boolean {
    if (prompt.length <= 50) return false;
    if (/\{\{.*?\}\}/.test(prompt)) return false;
    return true;
  }

  private traitHash(traits: Trait[]): string {
    if (traits.length === 0) return "none";
    return traits
      .map((t) => `${t.dimension}=${t.value.toFixed(2)}`)
      .sort()
      .join(",");
  }
}
