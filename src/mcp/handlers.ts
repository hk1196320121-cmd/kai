import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkDuplicate } from "../core/profile/dedup";
import { Derivator } from "../core/profile/derivator";
import { ProfileEngine } from "../core/profile/engine";
import { internalToMcp, mcpToInternal } from "../core/profile/mcp-scale";
import { ProvenanceEngine } from "../core/profile/provenance";
import type { KaiDB } from "../db/client";
import { LLMProvider } from "../llm/provider";
import {
  DeriveTriggerSchema,
  ObserveBatchSchema,
  ObserveSubmitSchema,
  ProfileReadSchema,
  ProfileWhySchema,
} from "./schema";
import { log, safeJsonParse } from "./utils";

function textContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export function registerHandlers(server: McpServer, db: KaiDB): void {
  const engine = new ProfileEngine(db);
  const provenance = new ProvenanceEngine(engine);
  const llmProvider = new LLMProvider();

  // Rate limiting for observe.submit
  const submitTimestamps: number[] = [];
  const RATE_LIMIT_WINDOW = 60_000;
  const RATE_LIMIT_MAX = 60;

  function checkRateLimit(): boolean {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    while (submitTimestamps.length > 0 && submitTimestamps[0] < windowStart) {
      submitTimestamps.shift();
    }
    if (submitTimestamps.length >= RATE_LIMIT_MAX) return false;
    submitTimestamps.push(now);
    return true;
  }

  // --- profile.read ---
  server.tool(
    "profile.read",
    ProfileReadSchema,
    async ({ scope, dimensions }) => {
      log("profile.read", { scope, dimensions });
      const identity = engine.getIdentity();
      const allTraits = engine.getTraits();

      if (scope === "identity") {
        const parsed = identity
          ? {
              name: identity.name,
              role: identity.role,
              goals: safeJsonParse(identity.goals),
              expertise_areas: safeJsonParse(identity.expertise_areas),
              learning_interests: safeJsonParse(identity.learning_interests),
              work_context: identity.work_context,
              communication_style: identity.communication_style,
            }
          : null;
        return textContent({ identity: parsed });
      }

      if (scope === "traits") {
        let traits = allTraits;
        if (dimensions && dimensions.length > 0) {
          traits = allTraits.filter((t) => dimensions.includes(t.dimension));
        }
        return textContent({
          traits: traits.map((t) => ({
            dimension: t.dimension,
            value: t.value,
            confidence: internalToMcp(t.confidence),
            lastReinforced: t.updated_at,
          })),
        });
      }

      // scope === "summary" or "full"
      const profile = engine.getProfile();
      const topTraits = [...allTraits]
        .sort(
          (a, b) =>
            b.confidence - a.confidence ||
            b.updated_at.localeCompare(a.updated_at),
        )
        .slice(0, 5)
        .map((t) => ({
          name: t.dimension,
          value: t.value,
          confidence: internalToMcp(t.confidence),
        }));

      const summary = {
        identity: identity
          ? {
              name: identity.name,
              role: identity.role,
              goals: safeJsonParse(identity.goals),
              expertise_areas: safeJsonParse(identity.expertise_areas),
            }
          : null,
        topTraits,
        observationCount: profile.observationCount,
      };

      if (scope === "full") {
        return textContent({
          ...summary,
          traits: allTraits.map((t) => ({
            dimension: t.dimension,
            value: t.value,
            confidence: internalToMcp(t.confidence),
            lastReinforced: t.updated_at,
          })),
        });
      }

      return textContent(summary);
    },
  );

  // --- profile.why ---
  server.tool("profile.why", ProfileWhySchema, async ({ dimension }) => {
    log("profile.why", { dimension });
    const explanation = provenance.why(dimension);
    if (!explanation) {
      const available = engine.getTraits().map((t) => t.dimension);
      return textContent({
        error: "trait_not_found",
        dimension,
        availableDimensions: available,
      });
    }
    return textContent({
      dimension: explanation.dimension,
      value: explanation.traitValue,
      confidence: internalToMcp(explanation.traitConfidence),
      provenance: {
        observations: explanation.relatedObservations.slice(0, 10).map((o) => ({
          id: o.id,
          text: o.value,
          timestamp: o.ts,
        })),
        method: explanation.traitSource === "observed" ? "rule" : "llm",
      },
    });
  });

  // --- observe.submit ---
  server.tool(
    "observe.submit",
    ObserveSubmitSchema,
    async ({ text, sourceTool, confidence, tags, context }) => {
      log("observe.submit", { textLength: text.length, sourceTool });

      if (!checkRateLimit()) {
        return textContent({ error: "rate_limited" });
      }

      const escapedTool = sourceTool.replace(/:/g, "_");
      const { isDuplicate, hash } = checkDuplicate(
        engine,
        `mcp:${escapedTool}`,
        text,
        { tags, context },
      );
      if (isDuplicate) {
        const existing = engine.getObservations({
          key: `mcp:${escapedTool}:${hash}`,
        });
        return textContent({
          duplicate: true,
          existingId: existing[0]?.id ?? null,
        });
      }

      const internalConfidence =
        confidence !== undefined ? mcpToInternal(confidence) : 5;
      const id = engine.addObservation({
        type: "signal",
        key: `mcp:${escapedTool}:${hash}`,
        value: JSON.stringify({
          text,
          tags: tags ?? [],
          context: context ?? "",
        }),
        confidence: internalConfidence,
        source: "mcp",
        provenance: JSON.stringify({
          source_tool: sourceTool,
          submitted_via: "mcp",
          submitted_at: new Date().toISOString(),
        }),
      });

      return textContent({
        id,
        text,
        source: "mcp",
        type: "signal",
        timestamp: new Date().toISOString(),
        dedupHash: hash,
      });
    },
  );

  // --- derive.trigger ---
  server.tool("derive.trigger", DeriveTriggerSchema, async ({ method }) => {
    log("derive.trigger", { method });
    const derivator = new Derivator(engine);
    const results: { dimension: string; value: number; confidence: number }[] =
      [];

    if (method === "rules" || method === "both") {
      const ruleResults = derivator.deriveFromRules();
      for (const t of ruleResults) {
        results.push({
          dimension: t.dimension,
          value: t.value,
          confidence: internalToMcp(t.confidence),
        });
      }
    }

    if (method === "llm" || method === "both") {
      if (!llmProvider.getConfig().apiKey) {
        if (method === "llm") {
          return textContent({ error: "llm_not_configured" });
        }
      } else {
        try {
          const llmResults = await derivator.deriveFromLLM(llmProvider);
          for (const t of llmResults) {
            results.push({
              dimension: t.dimension,
              value: t.value,
              confidence: internalToMcp(t.confidence),
            });
          }
        } catch {
          if (method === "llm" && results.length === 0) {
            return textContent({
              error: "llm_call_failed",
              derived: 0,
              traits: [],
            });
          }
        }
      }
    }

    return textContent({ derived: results.length, traits: results });
  });

  // --- observe.batch ---
  server.tool(
    "observe.batch",
    ObserveBatchSchema,
    async ({ sourceTool, observations }) => {
      log("observe.batch", { sourceTool, count: observations.length });
      let submitted = 0;
      let duplicates = 0;
      let errors = 0;
      const results: { id?: number; text: string; duplicate: boolean }[] = [];
      const escapedTool = sourceTool.replace(/:/g, "_");

      for (const obs of observations) {
        if (!checkRateLimit()) {
          errors += observations.length - results.length;
          break;
        }
        try {
          const { isDuplicate, hash } = checkDuplicate(
            engine,
            `mcp:${escapedTool}`,
            obs.text,
            { tags: obs.tags, context: obs.context },
          );
          if (isDuplicate) {
            duplicates++;
            results.push({ text: obs.text, duplicate: true });
            continue;
          }

          const internalConfidence =
            obs.confidence !== undefined ? mcpToInternal(obs.confidence) : 5;
          const id = engine.addObservation({
            type: "signal",
            key: `mcp:${escapedTool}:${hash}`,
            value: JSON.stringify({
              text: obs.text,
              tags: obs.tags ?? [],
              context: obs.context ?? "",
            }),
            confidence: internalConfidence,
            source: "mcp",
            provenance: JSON.stringify({
              source_tool: sourceTool,
              submitted_via: "mcp",
              submitted_at: new Date().toISOString(),
            }),
          });
          submitted++;
          results.push({ id, text: obs.text, duplicate: false });
        } catch {
          errors++;
          results.push({ text: obs.text, duplicate: false });
        }
      }

      return textContent({ submitted, duplicates, errors, results });
    },
  );
}
