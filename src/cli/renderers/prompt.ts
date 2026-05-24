import { dim, header, kv, section, table } from "../format";
import type {
  PromptChampion,
  PromptGene,
  PromptTournament,
} from "../../core/prompt/types";

/**
 * Render a prompt champion with detailed key-value info.
 */
export function renderChampion(champion: PromptChampion): string {
  const lines: string[] = [];

  lines.push(header(`Prompt Champion — ${champion.task}`));
  lines.push("");

  lines.push(kv("task", champion.task));
  lines.push(kv("segment", champion.segment_id));
  lines.push(
    kv("variant", champion.variant_id.slice(0, 8)),
  );
  lines.push(kv("model", champion.model));
  lines.push(kv("win rate", `${(champion.win_rate * 100).toFixed(1)}%`));
  lines.push(kv("battle count", champion.battle_count));
  lines.push(
    kv("promoted", champion.promoted_at.slice(0, 10)),
  );

  const lockStatus = champion.is_locked
    ? `Yes ${dim("[LOCKED]")}`
    : "No";
  lines.push(kv("locked", lockStatus));

  return lines.join("\n");
}

/**
 * Render a list of prompt genes as a table.
 */
export function renderGeneList(genes: PromptGene[]): string {
  const lines: string[] = [];

  lines.push(header("Genes"));
  lines.push("");

  if (genes.length === 0) {
    lines.push(dim("No genes found."));
    return lines.join("\n");
  }

  const rows = genes.map((gene) => [
    gene.id.slice(0, 8),
    gene.task,
    gene.type,
    gene.content.length > 50
      ? `${gene.content.slice(0, 47)}...`
      : gene.content,
  ]);

  lines.push(table(["ID", "Task", "Type", "Content"], rows));

  return lines.join("\n");
}

/**
 * Render tournament results as a table.
 */
export function renderTournamentResults(
  results: PromptTournament[],
): string {
  const lines: string[] = [];

  lines.push(header("Tournaments"));
  lines.push("");

  if (results.length === 0) {
    lines.push(dim("No tournament results found."));
    return lines.join("\n");
  }

  const rows = results.map((t) => {
    let winner: string;
    if (t.winner === "a") {
      winner = `A (${t.variant_a_id.slice(0, 8)})`;
    } else if (t.winner === "b") {
      winner = `B (${t.variant_b_id.slice(0, 8)})`;
    } else if (t.winner === "tie") {
      winner = "Tie";
    } else {
      winner = "Pending";
    }

    const confidence =
      t.judge_confidence != null
        ? t.judge_confidence.toFixed(2)
        : "N/A";

    return [
      t.id.slice(0, 8),
      `${t.variant_a_id.slice(0, 8)} vs ${t.variant_b_id.slice(0, 8)}`,
      winner,
      confidence,
      t.created_at.slice(0, 10),
    ];
  });

  lines.push(table(["ID", "Matchup", "Winner", "Conf", "Date"], rows));

  return lines.join("\n");
}
