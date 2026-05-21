export type TriggerType = "mcp_request" | "internal" | "cron";
export type TraceStatus = "running" | "completed" | "error";
export type SpanStatus = "running" | "ok" | "error";
export type OperationType =
  | "mcp_tool"
  | "derivation"
  | "task_exec"
  | "genome_compile"
  | "genome_evolve"
  | "llm_call"
  | "db_write";
export type EntityType =
  | "trait"
  | "preference"
  | "task"
  | "idea"
  | "gene"
  | "observation";

export interface Trace {
  id: string;
  trigger: TriggerType;
  tool_name?: string | null;
  root_cause?: string | null;
  started_at: string;
  duration_ms: number | null;
  status: TraceStatus;
}

export interface Span {
  id: string;
  trace_id: string;
  parent_span_id?: string | null;
  operation: OperationType;
  name: string;
  started_at: string;
  duration_ms: number | null;
  status: SpanStatus;
  attributes: Record<string, unknown>;
}

export interface TelemetryEvent {
  id: number;
  span_id: string;
  trace_id: string;
  type: "info" | "warning" | "error" | "metric";
  name: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface StateChange {
  id: number;
  span_id: string;
  trace_id: string;
  entity_type: EntityType;
  entity_id: string;
  field: string;
  old_value?: string | null;
  new_value?: string | null;
  reason?: string | null;
  created_at: string;
}

export interface TelemetryError {
  id: number;
  span_id: string;
  trace_id: string;
  error_type: string;
  message: string;
  stack_trace?: string | null;
  recoverable: number;
  context: Record<string, unknown>;
  created_at: string;
}

export interface ExplainInsight {
  claim: string;
  evidence: string;
}

export interface ExplainResult {
  summary: string;
  traces: string[];
  insights: ExplainInsight[];
}
