import { z } from "zod";

export const IdeaSubmitSchema = {
  title: z.string().min(1).max(200).describe("Idea title"),
  description: z
    .string()
    .min(1)
    .max(5000)
    .describe("Detailed description of the idea"),
  domain: z
    .enum(["coding", "writing", "research", "creative", "general"])
    .optional()
    .default("general"),
  priority: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .default("medium"),
  deadline: z.string().optional().describe("Optional ISO date deadline"),
  workspace_id: z
    .string()
    .optional()
    .describe("Existing workspace ID (auto-created if omitted)"),
};

export const IdeaPlanSchema = {
  idea_id: z.string().describe("ID of the idea to plan"),
};

export const PlanApproveSchema = {
  idea_id: z.string().describe("ID of the idea to approve"),
  task_modifications: z
    .array(
      z.object({
        task_id: z.string().optional(),
        action: z.enum(["update", "remove", "add"]),
        field: z
          .enum(["title", "agent", "prompt", "cron_schedule", "type"])
          .optional(),
        value: z.string().optional(),
      }),
    )
    .optional()
    .describe("Optional modifications to the plan"),
};

export const TaskExecuteSchema = {
  task_id: z.string().describe("ID of the task to execute"),
};

export const IdeaPauseSchema = {
  idea_id: z.string().describe("ID of the idea to pause"),
};

export const ExecutionStatusSchema = {
  idea_id: z.string().optional().describe("Filter by idea ID"),
  task_id: z.string().optional().describe("Filter by task ID"),
  feedback: z
    .string()
    .optional()
    .describe("Optional feedback for the latest result"),
};

export const ReplanSchema = {
  idea_id: z.string().describe("ID of the idea to re-plan"),
};
