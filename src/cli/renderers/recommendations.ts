import type { Recommendation } from "../../core/orchestrator/recommend";
import { dim, emphasis, header, nextSteps } from "../format";

/**
 * Render task recommendations with scores and explanations.
 */
export function renderRecommendations(recs: Recommendation[]): string {
  const lines: string[] = [];

  lines.push(header("Recommendations"));
  lines.push("");

  if (recs.length === 0) {
    lines.push(dim("No recommendations available yet."));
    return lines.join("\n");
  }

  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const num = `${i + 1}.`;
    const scorePct = Math.round(rec.score * 100);
    const badge = emphasis(`[${scorePct}%]`);

    lines.push(`${num} ${rec.title}  ${badge}`);
    lines.push(`   ${dim(rec.description)}`);
    lines.push(`   ${dim(`Why: ${rec.explanation}`)}`);
    lines.push("");

    // Show whyNotOthers only for the first recommendation
    if (i === 0 && rec.whyNotOthers && rec.whyNotOthers.length > 0) {
      lines.push(`   ${dim("Not shown:")}`);
      for (const reason of rec.whyNotOthers) {
        lines.push(`     ${dim(`- ${reason}`)}`);
      }
      lines.push("");
    }
  }

  lines.push(
    nextSteps([
      "Select: number (1-N) to pick one, [A]ll to approve all, [N]o to skip",
    ]),
  );

  return lines.join("\n");
}
