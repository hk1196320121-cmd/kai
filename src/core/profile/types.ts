export interface Identity {
  id: string;
  name: string;
  role: string;
  goals: string; // JSON array
  expertise_areas: string; // JSON array
  learning_interests: string; // JSON array
  work_context: string;
  communication_style: string;
  created_at: string;
  updated_at: string;
}

export interface Trait {
  id: string;
  dimension: string; // e.g. "scope_appetite", "risk_tolerance", "autonomy"
  value: number; // 0.0 - 1.0
  confidence: number; // 1-10
  source: "declared" | "observed" | "inferred" | "cross-model";
  reasoning: string; // Why this trait value was derived
  updated_at: string;
}

export interface Preference {
  id: string;
  key: string;
  value: string; // JSON string
  source: "user-stated" | "inferred";
  created_at: string;
}

export interface Observation {
  id: number; // auto-increment
  type: "behavior" | "preference" | "feedback" | "context" | "signal";
  key: string;
  value: string; // JSON payload
  confidence: number; // 1-10
  source: "cron_output" | "session_log" | "user_stated" | "inferred" | "mcp";
  provenance: string; // JSON: { origin_file, extracted_at, extractor_version }
  ts: string; // ISO 8601
}

// DAO typed getter result types
export interface BehaviorObservation {
  action: string;
  frequency: number;
  context: string;
}

export interface ProfileSnapshot {
  identity: Identity | null;
  traits: Trait[];
  preferences: Preference[];
  observationCount: number;
  recentObservations: Observation[];
}

export interface ProvenanceChain {
  observationId: number;
  originFile: string;
  extractedAt: string;
  extractorVersion: string;
  relatedTraits: string[]; // trait dimension names derived from this observation
}

// Hermes bridge types
export interface HermesCronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  last_run: string | null;
}

export interface HermesSkill {
  name: string;
  description: string;
  path: string;
}
