import { KaiDB } from "../../db/client";
import type {
  Identity, Trait, Preference, Observation,
  BehaviorObservation, ProfileSnapshot,
} from "./types";
import { randomUUID } from "crypto";

export interface CreateIdentityInput {
  name: string;
  role: string;
  goals?: string;
  expertise_areas?: string;
  learning_interests?: string;
  work_context?: string;
  communication_style?: string;
}

export interface AddObservationInput {
  type: Observation["type"];
  key: string;
  value: string;
  confidence: number;
  source: Observation["source"];
  provenance: string;
}

export interface SetTraitInput {
  dimension: string;
  value: number;
  confidence: number;
  source: Trait["source"];
  reasoning: string;
}

export interface SetPreferenceInput {
  key: string;
  value: string;
  source: Preference["source"];
}

const ALLOWED_IDENTITY_FIELDS = new Set([
  'name', 'role', 'goals', 'expertise_areas', 'learning_interests',
  'work_context', 'communication_style',
]);

export class ProfileEngine {
  private db;

  constructor(kaiDb: KaiDB) {
    this.db = kaiDb.getDatabase();
  }

  createIdentity(input: CreateIdentityInput): string {
    const existing = this.getIdentity();
    if (existing) {
      throw new Error("Identity already exists. Use `kai profile update` to modify it.");
    }
    const id = randomUUID();
    this.db.query(
      `INSERT INTO identity (id, name, role, goals, expertise_areas, learning_interests, work_context, communication_style)
       VALUES ($id, $name, $role, $goals, $expertise, $interests, $context, $style)`
    ).run({
      $id: id,
      $name: input.name,
      $role: input.role,
      $goals: input.goals ?? "[]",
      $expertise: input.expertise_areas ?? "[]",
      $interests: input.learning_interests ?? "[]",
      $context: input.work_context ?? "",
      $style: input.communication_style ?? "",
    });
    return id;
  }

  getIdentity(): Identity | null {
    return this.db.query("SELECT * FROM identity LIMIT 1").get() as Identity | null;
  }

  updateIdentity(fields: Partial<Omit<Identity, "id" | "created_at">>): void {
    const identity = this.getIdentity();
    if (!identity) throw new Error("No identity found. Run bootstrap first.");
    const sets: string[] = [];
    const params: Record<string, string | number | null> = { $id: identity.id };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        if (!ALLOWED_IDENTITY_FIELDS.has(key)) {
          throw new Error(`Unknown identity field: ${key}`);
        }
        sets.push(`${key} = $${key}`);
        params[`$${key}`] = value as string | number | null;
      }
    }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    this.db.query(`UPDATE identity SET ${sets.join(", ")} WHERE id = $id`).run(params);
  }

  addObservation(input: AddObservationInput): number {
    const result = this.db.query(
      `INSERT INTO observations (type, key, value, confidence, source, provenance, ts)
       VALUES ($type, $key, $value, $confidence, $source, $provenance, datetime('now'))`
    ).run({
      $type: input.type,
      $key: input.key,
      $value: input.value,
      $confidence: input.confidence,
      $source: input.source,
      $provenance: input.provenance,
    });
    return Number(result.lastInsertRowid);
  }

  getObservations(filter?: { type?: string; since?: string; key?: string }): Observation[] {
    let sql = "SELECT * FROM observations WHERE 1=1";
    const params: Record<string, string> = {};
    if (filter?.type) { sql += " AND type = $type"; params.$type = filter.type; }
    if (filter?.since) { sql += " AND ts >= $since"; params.$since = filter.since; }
    if (filter?.key) { sql += " AND key = $key"; params.$key = filter.key; }
    sql += " ORDER BY ts DESC";
    return this.db.query(sql).all(params) as Observation[];
  }

  getBehaviorObservations(): BehaviorObservation[] {
    const rows = this.getObservations({ type: "behavior" });
    const results: BehaviorObservation[] = [];
    for (const row of rows) {
      try {
        results.push(JSON.parse(row.value) as BehaviorObservation);
      } catch {
        // Skip malformed JSON
      }
    }
    return results;
  }

  setTrait(input: SetTraitInput): string {
    const id = randomUUID();
    this.db.query(
      `INSERT INTO traits (id, dimension, value, confidence, source, reasoning, updated_at)
       VALUES ($id, $dimension, $value, $confidence, $source, $reasoning, datetime('now'))
       ON CONFLICT(dimension) DO UPDATE SET
         value = excluded.value,
         confidence = excluded.confidence,
         source = excluded.source,
         reasoning = excluded.reasoning,
         updated_at = datetime('now'),
         id = excluded.id`
    ).run({
      $id: id,
      $dimension: input.dimension,
      $value: input.value,
      $confidence: input.confidence,
      $source: input.source,
      $reasoning: input.reasoning,
    });
    return id;
  }

  getTraits(filter?: { dimension?: string }): Trait[] {
    if (filter?.dimension) {
      return this.db.query("SELECT * FROM traits WHERE dimension = $dim").all({ $dim: filter.dimension }) as Trait[];
    }
    return this.db.query("SELECT * FROM traits ORDER BY dimension").all() as Trait[];
  }

  setPreference(input: SetPreferenceInput): string {
    const id = randomUUID();
    this.db.query(
      `INSERT INTO preferences (id, key, value, source)
       VALUES ($id, $key, $value, $source)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         source = excluded.source,
         id = excluded.id`
    ).run({
      $id: id,
      $key: input.key,
      $value: input.value,
      $source: input.source,
    });
    return id;
  }

  getPreferences(): Preference[] {
    return this.db.query("SELECT * FROM preferences ORDER BY key").all() as Preference[];
  }

  getProfile(): ProfileSnapshot {
    const identity = this.getIdentity();
    const traits = this.getTraits();
    const preferences = this.getPreferences();
    const countRow = this.db.query("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number };
    const recentObs = this.db.query("SELECT * FROM observations ORDER BY ts DESC LIMIT 20").all() as Observation[];
    return {
      identity,
      traits,
      preferences,
      observationCount: countRow.cnt,
      recentObservations: recentObs,
    };
  }

  getObservationById(id: number): Observation | null {
    return this.db.query("SELECT * FROM observations WHERE id = ?").get(id) as Observation | null;
  }

  removeTrait(dimension: string): boolean {
    const result = this.db.query("DELETE FROM traits WHERE dimension = ?").run(dimension);
    return result.changes > 0;
  }
}
