import type { Command } from "commander";
import { explainTelemetry } from "../core/telemetry/explain";
import { getTelemetryStats } from "../core/telemetry/stats";
import { TelemetryStore } from "../core/telemetry/store";
import { KaiDB } from "../db/client";
import { LLMProvider } from "../llm/provider";
import {
  renderErrorList,
  renderHealthReport,
  renderTrace,
} from "./renderers/telemetry";
import { getDbPath } from "./utils";

function getStore(): { db: KaiDB; store: TelemetryStore } {
  const db = new KaiDB(getDbPath());
  const store = new TelemetryStore(db);
  return { db, store };
}

export function registerTelemetryCommands(program: Command): void {
  const telemetry = program
    .command("telemetry")
    .description("Telemetry and observability commands");

  telemetry
    .command("health")
    .option("--json", "Output as JSON")
    .description("Quick telemetry health summary")
    .action((opts) => {
      const { db, store } = getStore();
      try {
        const stats = getTelemetryStats(store, 24);
        if (opts.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(renderHealthReport(stats));
        }
      } finally {
        db.close();
      }
    });

  telemetry
    .command("query <sql>")
    .option("--json", "Output as JSON (default)")
    .option("--format <format>", "Output format: json or table", "json")
    .description("Execute SQL against telemetry views (SELECT only)")
    .action((sql: string, opts) => {
      const { db, store } = getStore();
      try {
        const rows = store.queryTelemetry(sql);
        if (opts.format === "table") {
          if (rows.length === 0) {
            console.log("No results.");
          } else {
            const keys = Object.keys(rows[0]);
            console.log(keys.join("\t"));
            for (const row of rows) {
              console.log(keys.map((k) => String(row[k] ?? "NULL")).join("\t"));
            }
          }
        } else {
          console.log(JSON.stringify(rows, null, 2));
        }
      } catch (err) {
        console.error(`Query error: ${(err as Error).message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });

  telemetry
    .command("trace <traceId>")
    .option("--json", "Output as JSON")
    .description("Retrieve full causal trace by ID")
    .action((traceId: string, opts) => {
      const { db, store } = getStore();
      try {
        const trace = store.getTrace(traceId);
        if (!trace) {
          console.error(`Trace '${traceId}' not found.`);
          process.exit(1);
        }
        const spans = store.getSpansByTrace(traceId);
        const events = store.getEventsByTrace(traceId);
        const changes = store.getStateChangesByTrace(traceId);
        const errors = store.getErrorsByTrace(traceId);

        if (opts.json) {
          console.log(
            JSON.stringify({ trace, spans, events, changes, errors }, null, 2),
          );
        } else {
          console.log(renderTrace(trace, spans));
          if (events.length > 0) {
            console.log(`\nEvents (${events.length}):`);
            for (const e of events.slice(0, 20)) {
              console.log(`  [${e.type}] ${e.name}`);
            }
          }
          if (changes.length > 0) {
            console.log(`\nState Changes (${changes.length}):`);
            for (const c of changes) {
              console.log(
                `  ${c.entity_type}:${c.entity_id}.${c.field} ${c.old_value ?? "null"} → ${c.new_value ?? "null"}`,
              );
            }
          }
          if (errors.length > 0) {
            console.log(`\nErrors (${errors.length}):`);
            for (const e of errors) {
              console.log(`  [${e.error_type}] ${e.message}`);
            }
          }
        }
      } finally {
        db.close();
      }
    });

  telemetry
    .command("errors")
    .option("--last <n>", "Number of recent errors to show", "50")
    .option("--json", "Output as JSON")
    .description("Show recent errors with context")
    .action((opts) => {
      const { db, store } = getStore();
      try {
        const limit = Number.parseInt(opts.last, 10) || 50;
        const errors = store.getRecentErrors(limit);
        if (opts.json) {
          console.log(JSON.stringify(errors, null, 2));
        } else {
          console.log(renderErrorList(errors));
        }
      } finally {
        db.close();
      }
    });

  telemetry
    .command("explain <question>")
    .option("--json", "Output as JSON")
    .description("Natural language analysis of telemetry data")
    .action(async (question: string, opts) => {
      const { db, store } = getStore();
      try {
        const result = await explainTelemetry(
          store,
          question,
          new LLMProvider(),
        );
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`\n=== Telemetry Analysis ===`);
          console.log(result.summary);
          if (result.insights.length > 0) {
            console.log("\nInsights:");
            for (const i of result.insights) {
              console.log(`  - ${i.claim}`);
              console.log(`    Evidence: ${i.evidence}`);
            }
          }
        }
      } finally {
        db.close();
      }
    });
}
