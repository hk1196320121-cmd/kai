import { z } from "zod";

export const ProfileReadSchema = {
  scope: z
    .enum(["summary", "identity", "traits", "full"])
    .optional()
    .default("summary"),
  dimensions: z
    .array(z.string())
    .optional()
    .describe("Filter to specific trait dimensions"),
};

export const ProfileWhySchema = {
  dimension: z
    .string()
    .describe("Trait dimension to explain (e.g., 'early_riser', 'tinkerer')"),
};

export const ObserveSubmitSchema = {
  text: z
    .string()
    .min(1)
    .max(10240)
    .describe("The observation text (max 10KB)"),
  sourceTool: z
    .string()
    .min(1)
    .max(64)
    .describe("Name of the submitting tool (e.g., 'claude-code')"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Confidence in this observation (0-1)"),
  tags: z.array(z.string()).optional().describe("Categorization tags"),
  context: z
    .string()
    .optional()
    .describe("What was happening when this observation was made"),
};

export const DeriveTriggerSchema = {
  method: z
    .enum(["rules", "llm", "both"])
    .optional()
    .default("rules"),
};

export const ObserveBatchSchema = {
  sourceTool: z
    .string()
    .min(1)
    .max(64)
    .describe("Submitting tool name (applies to all observations)"),
  observations: z
    .array(
      z.object({
        text: z.string().min(1).max(10240),
        confidence: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
        context: z.string().optional(),
      }),
    )
    .max(50),
};
