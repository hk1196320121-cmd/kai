export type PromptTask = "planner" | "derivator" | "observer";
export type GeneType = "intent" | "contract" | "adapter" | "example" | "tone";
export type MutationType =
  | "seed"
  | "manual"
  | "intent_rephrase"
  | "contract_adjust"
  | "tone_shift"
  | "structure_change"
  | "adapter_tweak";
type EvalDifficulty = "easy" | "medium" | "hard";
export type EvalSource = "synthetic" | "real" | "edge_case";
export type TournamentWinner = "a" | "b" | "tie";

export interface PromptGene {
  id: string;
  task: PromptTask;
  type: GeneType;
  content: string;
  trait_bindings: string;
  metadata: string;
  created_at: string;
}

export interface PromptGenome {
  id: string;
  task: PromptTask;
  gene_ids: string;
  compiler_config: string;
  created_at: string;
}

export interface PromptVariant {
  id: string;
  genome_id: string;
  compiled_prompt: string;
  generation: number;
  parent_variant_id: string | null;
  mutation_type: MutationType | null;
  created_at: string;
}

export interface PromptSegment {
  id: string;
  name: string;
  trait_constraints: string;
  description: string;
  created_at: string;
}

export interface PromptEvalCase {
  id: string;
  task: PromptTask;
  input: string;
  expected_output: string | null;
  difficulty: EvalDifficulty;
  source: EvalSource;
  created_at: string;
}

export interface PromptTournament {
  id: string;
  task: PromptTask;
  variant_a_id: string;
  variant_b_id: string;
  eval_case_id: string;
  segment_id: string | null;
  model: string;
  winner: TournamentWinner | null;
  judge_reasoning: string | null;
  judge_confidence: number | null;
  judged_at: string | null;
  created_at: string;
}

export interface PromptChampion {
  id: string;
  task: PromptTask;
  segment_id: string;
  variant_id: string;
  model: string;
  win_rate: number;
  battle_count: number;
  promoted_at: string;
  previous_variant_id: string | null;
  is_locked: number;
}

export interface PromptChampionHistory {
  id: string;
  task: string;
  segment_id: string;
  variant_id: string;
  model: string;
  win_rate: number;
  battle_count: number;
  promoted_at: string;
  demoted_at: string | null;
  demotion_reason: string | null;
}

export interface CompiledPrompt {
  prompt: string;
  segment_id: string;
  genome_id: string;
  variant_id: string | null;
  gene_count: number;
  cached: boolean;
}

export interface TournamentResult {
  variant_a_id: string;
  variant_b_id: string;
  winner: TournamentWinner;
  reasoning: string;
  confidence: number;
}

export interface EvolutionResult {
  rounds_completed: number;
  battles_run: number;
  champion_promoted: boolean;
  champion_variant_id: string | null;
  previous_champion_variant_id: string | null;
}

export interface SegmentMatch {
  segment_id: string;
  segment_name: string;
  constraints_satisfied: number;
  is_default: boolean;
}
