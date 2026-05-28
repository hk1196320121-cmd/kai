import type { ProfileSnapshot } from "../../../core/profile/types";

export const PII_WHITELIST = new Set([
  "early_riser",
  "tinkerer",
  "consistent_user",
  "detail_oriented",
  "scope_appetite",
  "risk_tolerance",
  "planning_style",
  "schedule_rhythm",
  "preferred_output_shape",
  "disliked_behavior",
  "comm_style",
  "domain_context",
  "task_completion_rate",
  "autonomy",
]);

export function getBakedTraits(
  profile: ProfileSnapshot | null,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!profile) return result;

  for (const trait of profile.traits) {
    if (PII_WHITELIST.has(trait.dimension)) {
      result.set(trait.dimension, trait.value);
    }
  }
  return result;
}
