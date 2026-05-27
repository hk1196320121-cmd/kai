import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Derivator } from "../../core/profile/derivator";
import type { ProfileEngine } from "../../core/profile/engine";
import { internalToMcp } from "../../core/profile/mcp-scale";
import { GeneStore } from "../../core/prompt/gene-store";
import { PromptCompiler } from "../../core/prompt/prompt-compiler";
import type { TelemetryRecorder } from "../../core/telemetry/recorder";
import type { KaiDB } from "../../db/client";
import { LLMProvider } from "../../llm/provider";
import { DeriveTriggerSchema } from "../schema";
import { log, textContent, withTrace } from "../utils";

interface DeriveDeps {
  engine: ProfileEngine;
  db: KaiDB;
  telemetry: TelemetryRecorder | null;
}

export function registerDeriveHandlers(
  server: McpServer,
  deps: DeriveDeps,
): void {
  const { engine, db, telemetry } = deps;

  // LLMProvider is only used by derive.trigger — create internally
  const llmProvider = new LLMProvider();

  // --- derive.trigger ---
  server.tool(
    "derive.trigger",
    DeriveTriggerSchema,
    withTrace(
      "derive.trigger",
      async ({ method }) => {
        log("derive.trigger", { method });
        const derivator = new Derivator(engine, telemetry);
        const results: {
          dimension: string;
          value: number;
          confidence: number;
        }[] = [];

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
              const geneStore = new GeneStore(db);
              const compiler = new PromptCompiler(geneStore);
              engine.getTraits();
              const llmResults = await derivator.deriveFromLLM(
                llmProvider,
                compiler,
              );
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
      },
      telemetry,
    ),
  );
}
