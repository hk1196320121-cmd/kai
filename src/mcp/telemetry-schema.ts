import { z } from "zod";

export const TelemetryQuerySchema = {
  sql: z
    .string()
    .min(1)
    .describe("SQL query to execute against telemetry views (SELECT only)"),
};

export const TelemetryTraceSchema = {
  traceId: z
    .string()
    .describe("Trace ID to retrieve full causal trace for"),
};

export const TelemetryExplainSchema = {
  question: z
    .string()
    .min(1)
    .describe("Natural language question about recent telemetry"),
};
