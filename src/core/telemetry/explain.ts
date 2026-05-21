import type { LLMProvider } from "../../llm/provider";
import { getTelemetryStats } from "./stats";
import type { TelemetryStore } from "./store";
import type { ExplainResult } from "./types";

const EXPLAIN_SYSTEM_PROMPT = `You are a telemetry analyst. Analyze the provided telemetry data and answer the question.
Output JSON: { "summary": string, "traces": string[], "insights": [{ "claim": string, "evidence": string }] }
Keep summary under 200 words. Max 5 insights. Each insight: one claim + one evidence line.`;

const cache = new Map<string, { result: ExplainResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 100;
const CALLS: number[] = [];
const MAX_CALLS_PER_HOUR = 10;

export function _resetForTesting(): void {
  cache.clear();
  CALLS.length = 0;
}

export async function explainTelemetry(
  store: TelemetryStore,
  question: string,
  llm: LLMProvider | null,
): Promise<ExplainResult> {
  // Rate limiting
  const now = Date.now();
  while (CALLS.length > 0 && CALLS[0] < now - 3600000) CALLS.shift();
  if (CALLS.length >= MAX_CALLS_PER_HOUR) {
    return {
      summary: "Rate limit exceeded: 10 calls/hour. Try again later.",
      traces: [],
      insights: [],
    };
  }

  // Cache check
  const cacheKey = question;
  const cached = cache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  CALLS.push(now);

  // Gather data
  const stats = getTelemetryStats(store, 24);
  const recentErrors = store.getRecentErrors(50);

  // Stats-only fallback
  if (!llm?.getConfig().apiKey) {
    const summary = buildStatsSummary(stats, recentErrors.length);
    const result: ExplainResult = { summary, traces: [], insights: [] };
    cache.set(cacheKey, { result, timestamp: now });
    return result;
  }

  // LLM-powered analysis
  const inputData = {
    question,
    stats: {
      traceCount: stats.traceCount,
      errorCount: stats.errorCount,
      errorRate: stats.errorRate.toFixed(3),
      p95LatencyMs: stats.p95LatencyMs,
      topOperations: stats.topOperations.slice(0, 5),
      topMutatedEntities: stats.topMutatedEntities.slice(0, 5),
    },
    recentErrors: recentErrors.slice(0, 10).map((e) => ({
      error_type: e.error_type,
      message: e.message,
    })),
  };

  try {
    const response = await llm.call(
      JSON.stringify(inputData),
      EXPLAIN_SYSTEM_PROMPT,
      0,
      { max_tokens: 1000 },
    );

    const result: ExplainResult = {
      summary: String(response.summary ?? ""),
      traces: Array.isArray(response.traces)
        ? (response.traces as string[])
        : [],
      insights: Array.isArray(response.insights)
        ? (response.insights as Array<{ claim: string; evidence: string }>)
        : [],
    };

    cache.set(cacheKey, { result, timestamp: now });
    if (cache.size > CACHE_MAX_SIZE) {
      const oldest = [...cache.entries()].sort(
        (a, b) => a[1].timestamp - b[1].timestamp,
      );
      for (let i = 0; i < oldest.length - CACHE_MAX_SIZE; i++) {
        cache.delete(oldest[i][0]);
      }
    }
    return result;
  } catch {
    const summary = buildStatsSummary(stats, recentErrors.length);
    const result: ExplainResult = { summary, traces: [], insights: [] };
    // Don't cache LLM failures — allow retry on next call
    return result;
  }
}

function buildStatsSummary(
  stats: ReturnType<typeof getTelemetryStats>,
  recentErrorCount: number,
): string {
  const lines: string[] = [];
  lines.push(
    `Telemetry summary (last 24h): ${stats.traceCount} traces, ${stats.errorCount} errors (${(stats.errorRate * 100).toFixed(1)}% error rate).`,
  );
  lines.push(`P95 latency: ${stats.p95LatencyMs}ms.`);
  if (stats.topOperations.length > 0) {
    lines.push(
      `Top operations: ${stats.topOperations.map((o) => `${o.operation}(${o.count})`).join(", ")}.`,
    );
  }
  if (stats.topMutatedEntities.length > 0) {
    lines.push(
      `Most mutated: ${stats.topMutatedEntities.map((e) => `${e.entity_type}:${e.entity_id}(${e.change_count})`).join(", ")}.`,
    );
  }
  if (recentErrorCount > 0) {
    lines.push(`${recentErrorCount} recent errors in window.`);
  }
  return lines.join(" ");
}
