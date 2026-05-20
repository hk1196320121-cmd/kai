import {
  type McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { GeneStore } from "../core/prompt/gene-store";
import { PromptCompiler } from "../core/prompt/prompt-compiler";
import type { KaiDB } from "../db/client";

export function registerPromptResources(
  server: McpServer,
  db: KaiDB,
): void {
  const store = new GeneStore(db);
  const compiler = new PromptCompiler(store);

  // kai://prompt/{task} — compiled prompt for task
  const promptTaskTemplate = new ResourceTemplate(
    "kai://prompt/{task}",
    {
      list: async () => {
        const tasks = ["planner", "derivator", "observer"] as const;
        return {
          resources: tasks.map((t) => ({
            uri: `kai://prompt/${t}`,
            name: `Prompt: ${t}`,
          })),
        };
      },
    },
  );

  server.resource(
    "prompt-task",
    promptTaskTemplate,
    async (uri, variables) => {
      const task = (
        Array.isArray(variables.task) ? variables.task[0] : variables.task
      ) as "planner" | "derivator" | "observer";
      const compiled = await compiler.compile(task, []);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              task,
              segment: compiled.segment_id,
              gene_count: compiled.gene_count,
              prompt_preview: compiled.prompt.slice(0, 200) + "...",
            }),
          },
        ],
      };
    },
  );

  // kai://prompt/champion/{task}
  const championTaskTemplate = new ResourceTemplate(
    "kai://prompt/champion/{task}",
    {
      list: async () => {
        return {
          resources: [
            { uri: "kai://prompt/champion/planner", name: "Champion: planner" },
          ],
        };
      },
    },
  );

  server.resource(
    "prompt-champion",
    championTaskTemplate,
    async (uri, variables) => {
      const task = (
        Array.isArray(variables.task) ? variables.task[0] : variables.task
      ) as "planner" | "derivator" | "observer";
      const champion = store.getChampion(task, "default");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(champion ?? { task, champion: null }),
          },
        ],
      };
    },
  );

  // kai://prompt/evolution-history/{task}
  const historyTaskTemplate = new ResourceTemplate(
    "kai://prompt/evolution-history/{task}",
    {
      list: async () => {
        return {
          resources: [
            {
              uri: "kai://prompt/evolution-history/planner",
              name: "Evolution History: planner",
            },
          ],
        };
      },
    },
  );

  server.resource(
    "prompt-evolution-history",
    historyTaskTemplate,
    async (uri, variables) => {
      const task = (
        Array.isArray(variables.task) ? variables.task[0] : variables.task
      ) as "planner" | "derivator" | "observer";
      const history = store.getChampionHistory(task, "default");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ task, history }),
          },
        ],
      };
    },
  );
}
