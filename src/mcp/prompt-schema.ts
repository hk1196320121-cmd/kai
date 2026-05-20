import { z } from "zod";

export const PromptCompileSchema = {
  task: z
    .enum(["planner", "derivator", "observer"])
    .describe("Task to compile prompt for"),
};

export const PromptChampionSchema = {
  task: z
    .enum(["planner", "derivator", "observer"])
    .describe("Task to get champion for"),
  segment: z.string().optional().describe("Segment ID (default: 'default')"),
};

export const PromptEvolveSchema = {
  task: z
    .enum(["planner", "derivator", "observer"])
    .describe("Task to evolve"),
  rounds: z.number().optional().describe("Number of rounds (default: 1)"),
  auto_approve: z
    .boolean()
    .optional()
    .describe("Auto-approve promotion (default: false)"),
};
