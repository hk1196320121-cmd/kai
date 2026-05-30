/** Phase 2 nudge template — pre-architected for seamless Phase 2 integration. */
export interface NudgeTemplate {
  trait: string;
  threshold: { min: number } | { max: number };
  template: string;
}

/** Autopilot session row from autopilot_sessions table. */
export interface AutopilotSession {
  id: number;
  session_id: string;
  started_at: string;
  stopped_at: string | null;
  observations_count: number;
  traits_derived: number;
  traits_changed: number;
  derivation_status: "pending" | "completed" | "failed" | "skipped";
  project_path: string | null;
}

/** Input JSON from Claude Code hooks (received via stdin). */
export interface HookInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  [key: string]: unknown;
}
