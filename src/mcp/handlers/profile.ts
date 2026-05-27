import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProfileEngine } from "../../core/profile/engine";
import { internalToMcp } from "../../core/profile/mcp-scale";
import type { ProvenanceEngine } from "../../core/profile/provenance";
import type { TelemetryRecorder } from "../../core/telemetry/recorder";
import { ProfileReadSchema, ProfileWhySchema } from "../schema";
import { log, safeJsonParse, textContent, withTrace } from "../utils";

interface ProfileDeps {
  engine: ProfileEngine;
  provenance: ProvenanceEngine;
  telemetry: TelemetryRecorder | null;
}

export function registerProfileHandlers(
  server: McpServer,
  deps: ProfileDeps,
): void {
  const { engine, provenance, telemetry } = deps;

  // --- profile.read ---
  server.tool(
    "profile.read",
    ProfileReadSchema,
    withTrace(
      "profile.read",
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
      telemetry,
    ),
  );

  // --- profile.why ---
  server.tool(
    "profile.why",
    ProfileWhySchema,
    withTrace(
      "profile.why",
      async ({ dimension }) => {
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
            observations: explanation.relatedObservations
              .slice(0, 10)
              .map((o) => ({
                id: o.id,
                text: o.value,
                timestamp: o.ts,
              })),
            method: explanation.traitSource === "observed" ? "rule" : "llm",
          },
        });
      },
      telemetry,
    ),
  );
}
