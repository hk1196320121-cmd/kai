import type { IdeaDomain } from "./types";
import {
  matchTemplates,
  type ScoredRecommendation,
} from "./templates";

export interface Recommendation {
  templateId: string;
  title: string;
  description: string;
  score: number;
  explanation: string;
  whyNotOthers?: string[];
  matchedTraits: string[];
}

export function recommendTasks(
  traits: { dimension: string; value: number; confidence: number }[],
  domain: IdeaDomain,
): Recommendation[] {
  const scored = matchTemplates(traits, domain);
  const top3 = scored.slice(0, 3);
  const excluded = scored.slice(3);

  return top3.map((rec) => ({
    templateId: rec.template.id,
    title: rec.template.title,
    description: rec.template.description,
    score: rec.score,
    explanation: buildExplanation(rec),
    whyNotOthers:
      excluded.length > 0
        ? excluded.slice(0, 2).map(
            (ex) =>
              `${ex.template.title} (score: ${ex.score}) — ${ex.matchedTraits.length > 0 ? `matched on ${ex.matchedTraits.join(", ")}` : "generic template, ranked lower"}`,
          )
        : undefined,
    matchedTraits: rec.matchedTraits,
  }));
}

export function buildExplanation(rec: ScoredRecommendation): string {
  const parts: string[] = [];

  if (rec.matchedTraits.length > 0) {
    parts.push(`Matches your ${rec.matchedTraits.join(" and ")} profile`);
  }

  if (rec.score >= 0.8) {
    parts.push("strong match");
  } else if (rec.score >= 0.6) {
    parts.push("good fit for your work style");
  } else {
    parts.push("general-purpose workflow");
  }

  return parts.join(" — ");
}
