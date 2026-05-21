import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GeneStore } from "../core/prompt/gene-store";
import { PromptCompiler } from "../core/prompt/prompt-compiler";
import { PromptEvolver } from "../core/prompt/prompt-evolver";
import type { TelemetryRecorder } from "../core/telemetry/recorder";
import type { KaiDB } from "../db/client";
import { LLMProvider } from "../llm/provider";
import {
  PromptChampionSchema,
  PromptCompileSchema,
  PromptEvolveSchema,
} from "./prompt-schema";

function textContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export function registerPromptHandlers(
  server: McpServer,
  db: KaiDB,
  _telemetry: TelemetryRecorder | null = null,
): void {
  const store = new GeneStore(db);
  const compiler = new PromptCompiler(store);
  const llm = new LLMProvider();

  server.tool("prompt.compile", PromptCompileSchema, async ({ task }) => {
    const result = await compiler.compile(task, []);
    return textContent({
      task,
      segment: result.segment_id,
      gene_count: result.gene_count,
      cached: result.cached,
      prompt_length: result.prompt.length,
    });
  });

  server.tool(
    "prompt.champion",
    PromptChampionSchema,
    async ({ task, segment }) => {
      const segId = segment ?? "default";
      const champion = store.getChampion(task, segId);
      return textContent({ task, segment: segId, champion });
    },
  );

  server.tool(
    "prompt.evolve",
    PromptEvolveSchema,
    async ({ task, rounds, auto_approve }) => {
      const evolver = new PromptEvolver(store, llm);
      const result = await evolver.evolve({
        task,
        segment_id: "default",
        model: "gpt-4o-mini",
        rounds: rounds ?? 1,
        auto_approve: auto_approve ?? false,
      });
      return textContent(result);
    },
  );
}
