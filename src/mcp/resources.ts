import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KaiDB } from "../db/client";
import { ProfileEngine } from "../core/profile/engine";
import { internalToMcp } from "../core/profile/mcp-scale";

function safeJsonParse(str: string): unknown {
  try { return JSON.parse(str); } catch { return str; }
}

export function registerResources(server: McpServer, db: KaiDB): void {
  const engine = new ProfileEngine(db);

  // 1. kai://profile/identity
  server.resource("profile-identity", "kai://profile/identity", async (uri) => {
    const identity = engine.getIdentity();
    const parsed = identity
      ? {
          ...identity,
          goals: safeJsonParse(identity.goals),
          expertise_areas: safeJsonParse(identity.expertise_areas),
          learning_interests: safeJsonParse(identity.learning_interests),
        }
      : { identity: null };
    return {
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(parsed) },
      ],
    };
  });

  // 2. kai://profile/traits
  server.resource("profile-traits", "kai://profile/traits", async (uri) => {
    const traits = engine.getTraits().map((t) => ({
      dimension: t.dimension,
      value: t.value,
      confidence: internalToMcp(t.confidence),
      provenance: t.reasoning,
      lastReinforced: t.updated_at,
    }));
    return {
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify({ traits }) },
      ],
    };
  });

  // 3. kai://profile/traits/{dimension} — template resource
  const traitsDimensionTemplate = new ResourceTemplate(
    "kai://profile/traits/{dimension}",
    {
      list: async () => {
        const traits = engine.getTraits();
        return {
          resources: traits.map((t) => ({
            uri: `kai://profile/traits/${encodeURIComponent(t.dimension)}`,
            name: `Trait: ${t.dimension}`,
          })),
        };
      },
    },
  );
  server.resource(
    "profile-traits-dimension",
    traitsDimensionTemplate,
    async (uri, variables) => {
      const dimension = variables.dimension;
      const traits = engine.getTraits({ dimension }).map((t) => ({
        dimension: t.dimension,
        value: t.value,
        confidence: internalToMcp(t.confidence),
        provenance: t.reasoning,
        lastReinforced: t.updated_at,
      }));
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify({ traits }) },
        ],
      };
    },
  );

  // 4. kai://profile/observations/recent
  server.resource(
    "profile-observations-recent",
    "kai://profile/observations/recent",
    async (uri) => {
      const obs = engine.getObservations().slice(0, 50).map((o) => {
        let tags: string[] = [];
        try {
          const v = JSON.parse(o.value);
          if (Array.isArray(v.tags)) tags = v.tags;
        } catch {}
        return { id: o.id, text: o.value, source: o.source, timestamp: o.ts, tags };
      });
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(obs) },
        ],
      };
    },
  );

  // 5. kai://profile/summary
  server.resource("profile-summary", "kai://profile/summary", async (uri) => {
    const profile = engine.getProfile();
    const identity = profile.identity;
    const topTraits = profile.traits
      .sort((a, b) => b.confidence - a.confidence || b.updated_at.localeCompare(a.updated_at))
      .slice(0, 5)
      .map((t) => ({
        name: t.dimension,
        value: t.value,
        confidence: internalToMcp(t.confidence),
      }));
    const summaryIdentity = identity
      ? {
          name: identity.name,
          role: identity.role,
          location: "",
          timezone: "",
          language: "",
          goals: safeJsonParse(identity.goals),
          expertise_areas: safeJsonParse(identity.expertise_areas),
        }
      : null;
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            identity: summaryIdentity,
            topTraits,
            observationCount: profile.observationCount,
          }),
        },
      ],
    };
  });

  // 6. kai://system/health
  server.resource("system-health", "kai://system/health", async (uri) => {
    const integrity = db.integrityCheck();
    const database = db.getDatabase();

    let sizeBytes = 0;
    try {
      const pc = database.query("SELECT page_count as c FROM pragma_page_count()").get() as { c: number } | null;
      const ps = database.query("SELECT page_size as s FROM pragma_page_size()").get() as { s: number } | null;
      sizeBytes = (pc?.c ?? 0) * (ps?.s ?? 0);
    } catch {}

    const statsRow = database.query(
      "SELECT (SELECT COUNT(*) FROM observations) as observationCount, (SELECT COUNT(*) FROM traits) as traitCount"
    ).get() as { observationCount: number; traitCount: number };

    const lastObs = database.query(
      "SELECT ts FROM observations ORDER BY ts DESC LIMIT 1"
    ).get() as { ts: string } | null;

    const lastTrait = database.query(
      "SELECT updated_at FROM traits ORDER BY updated_at DESC LIMIT 1"
    ).get() as { updated_at: string } | null;

    const lastCron = database.query(
      "SELECT ts FROM observations WHERE source='cron_output' ORDER BY ts DESC LIMIT 1"
    ).get() as { ts: string } | null;

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            status: integrity === "ok" ? "ok" : "degraded",
            db: { integrity, sizeBytes },
            stats: {
              observationCount: statsRow.observationCount,
              traitCount: statsRow.traitCount,
              lastObservationAt: lastObs?.ts ?? null,
              lastDerivationAt: lastTrait?.updated_at ?? null,
              lastCollectionAt: lastCron?.ts ?? null,
            },
          }),
        },
      ],
    };
  });
}
