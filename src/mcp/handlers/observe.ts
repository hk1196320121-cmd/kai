import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkDuplicate } from "../../core/profile/dedup";
import type { ProfileEngine } from "../../core/profile/engine";
import { mcpToInternal } from "../../core/profile/mcp-scale";
import type { TelemetryRecorder } from "../../core/telemetry/recorder";
import { ObserveBatchSchema, ObserveSubmitSchema } from "../schema";
import { log, textContent, withTrace } from "../utils";

const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 60;

interface ObserveDeps {
  engine: ProfileEngine;
  telemetry: TelemetryRecorder | null;
}

export function registerObserveHandlers(
  server: McpServer,
  deps: ObserveDeps,
): void {
  const { engine, telemetry } = deps;

  // Rate limiting state — scoped to this registration instance
  const submitTimestamps: number[] = [];

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

  // --- observe.submit ---
  server.tool(
    "observe.submit",
    ObserveSubmitSchema,
    withTrace(
      "observe.submit",
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
      telemetry,
    ),
  );

  // --- observe.batch ---
  server.tool(
    "observe.batch",
    ObserveBatchSchema,
    withTrace(
      "observe.batch",
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
      telemetry,
    ),
  );
}
