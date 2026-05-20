import type { Trait } from "../profile/types";

export const DEFAULT_TRAITS: Record<string, number> = {
  detail_oriented: 0.5,
  risk_tolerance: 0.5,
  planning_style: 0.5,
  early_riser: 0.5,
  burst_worker: 0.3,
  consistency: 0.5,
  scope_appetite: 0.5,
  tinkerer: 0.5,
};

const SCHEDULING_GUIDANCE: Record<string, { high: string; low: string }> = {
  early_riser: {
    high: "Schedule cron tasks in 6-9am morning slots",
    low: "Avoid early morning scheduling",
  },
  burst_worker: {
    high: "Batch tasks in 2-hour focused windows",
    low: "Spread tasks evenly throughout the day",
  },
  detail_oriented: {
    high: "Use fine-grained tasks with explicit checkpoints",
    low: "Use broader tasks with flexible scope",
  },
  risk_tolerance: {
    high: "Use ambitious approaches, skip confirmation steps",
    low: "Use safe, conservative approaches with confirmation",
  },
};

const DECOMPOSITION_GUIDANCE: Record<string, { high: string; low: string }> = {
  detail_oriented: {
    high: "Decompose into many small, concrete tasks (6-8 per idea)",
    low: "Decompose into fewer, broader tasks (3-4 per idea)",
  },
  scope_appetite: {
    high: "Include stretch goals and ambitious tasks",
    low: "Focus on essential, achievable tasks",
  },
  planning_style: {
    high: "Decompose into same-day actionable chunks",
    low: "Decompose into weekly milestones",
  },
};

export function formatProfileContext(traits: Trait[]): string {
  const traitMap = new Map(traits.map((t) => [t.dimension, t.value]));
  const lines: string[] = ["## User Behavioral Profile", ""];

  for (const [dim, defaultValue] of Object.entries(DEFAULT_TRAITS)) {
    const value = traitMap.get(dim) ?? defaultValue;
    lines.push(`- ${dim}: ${value}`);
  }

  lines.push("", "## Scheduling Guidance", "");
  for (const [dim, guidance] of Object.entries(SCHEDULING_GUIDANCE)) {
    const value = traitMap.get(dim) ?? DEFAULT_TRAITS[dim] ?? 0.5;
    if (value >= 0.6) lines.push(`- ${guidance.high}`);
    else if (value <= 0.4) lines.push(`- ${guidance.low}`);
  }

  lines.push("", "## Decomposition Guidance", "");
  for (const [dim, guidance] of Object.entries(DECOMPOSITION_GUIDANCE)) {
    const value = traitMap.get(dim) ?? DEFAULT_TRAITS[dim] ?? 0.5;
    if (value >= 0.6) lines.push(`- ${guidance.high}`);
    else if (value <= 0.4) lines.push(`- ${guidance.low}`);
  }

  return lines.filter((l) => l !== "").join("\n");
}
