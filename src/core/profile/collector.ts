import { ProfileEngine } from "./engine";
import { HermesBridge } from "../../bridge/hermes";
import { createHash } from "crypto";

function parseCronHour(schedule: string): number | undefined {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 2) return undefined;
  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  if (isNaN(minute) || isNaN(hour) || hour < 0 || hour > 23) return undefined;
  return hour;
}

export class ProfileCollector {
  private engine: ProfileEngine;
  private bridge: HermesBridge;

  constructor(engine: ProfileEngine, bridge: HermesBridge) {
    this.engine = engine;
    this.bridge = bridge;
  }

  collectFromCronOutput(jobId: string, content: string, schedule?: string): number {
    const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);

    const existing = this.engine.getObservations({ key: `cron:${jobId}:${contentHash}` });
    if (existing.length > 0) return 0;

    const value: Record<string, unknown> = {
      jobId,
      contentPreview: content.slice(0, 200),
      contentLength: content.length,
    };
    if (schedule) {
      value.schedule = schedule;
      const hour = parseCronHour(schedule);
      if (hour !== undefined) value.hour = hour;
    }

    const id = this.engine.addObservation({
      type: "behavior",
      key: `cron:${jobId}:${contentHash}`,
      value: JSON.stringify(value),
      confidence: 5,
      source: "cron_output",
      provenance: JSON.stringify({
        origin_job: jobId,
        content_hash: contentHash,
        extracted_at: new Date().toISOString(),
        extractor_version: "0.2.0",
      }),
    });
    return id > 0 ? 1 : 0;
  }

  collectDaily(): number {
    const outputs = this.bridge.getAllCronOutputs();
    const jobs = this.bridge.listCronJobs();
    const jobSchedules = new Map(jobs.map((j) => [j.id, j.schedule]));
    let count = 0;
    for (const output of outputs) {
      count += this.collectFromCronOutput(output.jobId, output.content, jobSchedules.get(output.jobId));
    }
    return count;
  }
}
