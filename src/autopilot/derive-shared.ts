import type { Database } from "bun:sqlite";
import type { DerivedTrait } from "../core/profile/derivator";
import { RULES } from "../core/profile/rules";

/**
 * Shared rule-matching + trait derivation logic. [D3]
 * Used by both Derivator.deriveFromRules() and the Stop hook.
 * Takes a raw Database + corrections set, returns derived traits.
 */
export function deriveFromRulesCore(
  db: Database,
  corrections: Set<string>,
): DerivedTrait[] {
  const observations = db
    .query("SELECT * FROM observations ORDER BY ts DESC")
    .all() as Array<{
    id: number;
    type: string;
    key: string;
    value: string;
    confidence: number;
    source: string;
    provenance: string;
    ts: string;
  }>;

  if (observations.length === 0) return [];

  const dimMatches = new Map<
    string,
    {
      observations: typeof observations;
      derive: (typeof RULES)[number]["derive"];
      deriveFromValues?: (typeof RULES)[number]["deriveFromValues"];
    }
  >();

  for (const rule of RULES) {
    if (corrections.has(rule.dimension)) continue;
    const matches = observations.filter((obs) =>
      rule.match(obs.key, obs.value),
    );
    if (matches.length === 0) continue;

    const existing = dimMatches.get(rule.dimension);
    if (existing) {
      existing.observations.push(...matches);
      if (rule.deriveFromValues && !existing.deriveFromValues) {
        existing.deriveFromValues = rule.deriveFromValues;
      }
    } else {
      dimMatches.set(rule.dimension, {
        observations: [...matches],
        derive: rule.derive,
        deriveFromValues: rule.deriveFromValues,
      });
    }
  }

  const results: DerivedTrait[] = [];

  for (const [
    dimension,
    { observations: obs, derive, deriveFromValues },
  ] of dimMatches) {
    let derived: { value: number; confidence: number; reasoning: string };
    if (deriveFromValues) {
      const values = obs.map((o) => o.value);
      derived = deriveFromValues(obs.length, values);
    } else {
      derived = derive(obs.length);
    }
    const trait: DerivedTrait = {
      dimension,
      value: Math.round(derived.value * 100) / 100,
      confidence: Math.max(1, derived.confidence),
      source: "observed",
      reasoning: derived.reasoning,
    };
    results.push(trait);

    db.query(
      `INSERT INTO traits (id, dimension, value, confidence, source, reasoning, updated_at)
       VALUES (lower(hex(randomblob(16))), $dim, $val, $conf, 'observed', $reason, datetime('now'))
       ON CONFLICT(dimension) DO UPDATE SET
         value=excluded.value, confidence=excluded.confidence, source=excluded.source,
         reasoning=excluded.reasoning, updated_at=datetime('now'), id=excluded.id`,
    ).run({
      $dim: dimension,
      $val: trait.value,
      $conf: trait.confidence,
      $reason: trait.reasoning,
    });
  }

  return results;
}
