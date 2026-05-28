export interface WorkflowStep {
  id: string;
  params?: Record<string, unknown>;
}

export interface ProfileCondition {
  trait: string;
  threshold: number;
  include: string;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  tools: WorkflowStep[];
  profileConditions: ProfileCondition[];
  emptyProfileFallback?: string;
}
