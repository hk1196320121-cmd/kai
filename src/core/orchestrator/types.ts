export type IdeaDomain =
  | "coding"
  | "writing"
  | "research"
  | "creative"
  | "management"
  | "general";
export type IdeaPriority = "low" | "medium" | "high" | "critical";
export type IdeaStatus =
  | "draft"
  | "planned"
  | "executing"
  | "completed"
  | "paused";
export type TaskType = "one_off" | "cron";
export type TaskStatus =
  | "pending"
  | "scheduled"
  | "executing"
  | "completed"
  | "failed"
  | "paused";
export type AgentType = "hermes" | "openclaw" | "auto" | "claude";

export const DispatchError = {
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  TIMEOUT: "TIMEOUT",
  // OUTPUT_TRUNCATED and UNKNOWN reserved for future use
  OUTPUT_TRUNCATED: "OUTPUT_TRUNCATED",
  UNKNOWN: "UNKNOWN",
} as const;
export type DispatchError = (typeof DispatchError)[keyof typeof DispatchError];

export interface Idea {
  id: string;
  title: string;
  description: string;
  domain: IdeaDomain;
  priority: IdeaPriority;
  deadline?: string;
  status: IdeaStatus;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export interface PlannedTask {
  id: string;
  idea_id: string;
  workspace_id: string;
  title: string;
  description: string;
  type: TaskType;
  cron_schedule?: string;
  cron_prompt?: string;
  agent: AgentType;
  prompt: string;
  decomposition_rationale: string;
  scheduling_rationale: string;
  status: TaskStatus;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
}

export interface ExecutionResult {
  id: number;
  task_id: string;
  agent: string;
  success: boolean;
  output: string;
  duration_ms: number;
  user_feedback?: string;
  completed_at: string;
}

export interface ExecutionObservation {
  dimension: string;
  signal: string;
  confidence: number;
  source: "execution_result";
}
