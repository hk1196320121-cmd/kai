import type { Database } from "bun:sqlite";
import type { DerivedTrait } from "../core/profile/derivator";
import { RULES } from "../core/profile/rules";

/** Trait upsert SQL — shared between deriveFromRulesCore and test stubs. */
export const TRAIT_UPSERT_SQL = `
  INSERT INTO traits (id, dimension, value, confidence, source, reasoning, updated_at)
  VALUES (lower(hex(randomblob(16))), $dim, $val, $conf, 'observed', $reason, datetime('now'))
  ON CONFLICT(dimension) DO UPDATE SET
    value=excluded.value, confidence=excluded.confidence, source=excluded.source,
    reasoning=excluded.reasoning, updated_at=datetime('now'), id=excluded.id`;

/**
 * Pure computation: match observations against RULES, return derived traits.
 * Does NOT write to the database — callers decide when/how to persist.
 */
export function computeTraits(
  db: Database,
  corrections: Set<string>,
): DerivedTrait[] {
  // Bound result set to recent observations + limit to prevent memory exhaustion
  const observations = db
    .query(
      "SELECT * FROM observations WHERE ts >= datetime('now', '-30 days') ORDER BY ts DESC LIMIT 2000",
    )
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
      // Last rule wins for derive function — prevents dead code when
      // multiple rules target the same dimension (e.g., coldstart + autopilot autonomy)
      existing.derive = rule.derive;
      if (rule.deriveFromValues) {
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
    results.push({
      dimension,
      value: Math.round(derived.value * 100) / 100,
      confidence: Math.min(10, Math.max(1, derived.confidence)),
      source: "observed",
      reasoning: derived.reasoning,
    });
  }

  return results;
}

/**
 * Persist derived traits to the traits table (upsert).
 */
export function persistTraits(db: Database, traits: DerivedTrait[]): void {
  if (traits.length === 0) return;
  db.transaction(() => {
    const stmt = db.prepare(TRAIT_UPSERT_SQL);
    for (const trait of traits) {
      stmt.run({
        $dim: trait.dimension,
        $val: trait.value,
        $conf: trait.confidence,
        $reason: trait.reasoning,
      });
    }
  })();
}

/**
 * Convenience: compute + persist in one call.
 * Used by both Derivator.deriveFromRules() and the Stop hook.
 */
export function deriveFromRulesCore(
  db: Database,
  corrections: Set<string>,
): DerivedTrait[] {
  const traits = computeTraits(db, corrections);
  if (traits.length > 0) {
    persistTraits(db, traits);
  }
  return traits;
}
