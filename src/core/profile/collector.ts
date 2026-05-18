import type { HermesBridge } from "../../bridge/hermes";
import { checkDuplicate } from "./dedup";
import type { ProfileEngine } from "./engine";

function parseCronHour(schedule: string): number | undefined {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 2) return undefined;
  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  if (Number.isNaN(minute) || Number.isNaN(hour) || hour < 0 || hour > 23)
    return undefined;
  return hour;
}

export class ProfileCollector {
  private engine: ProfileEngine;
  private bridge: HermesBridge;

  constructor(engine: ProfileEngine, bridge: HermesBridge) {
    this.engine = engine;
    this.bridge = bridge;
  }

  collectFromCronOutput(
    jobId: string,
    content: string,
    schedule?: string,
  ): number {
    const { isDuplicate, hash } = checkDuplicate(
      this.engine,
      `cron:${jobId}`,
      content,
    );
    if (isDuplicate) return 0;

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
      key: `cron:${jobId}:${hash}`,
      value: JSON.stringify(value),
      confidence: 5,
      source: "cron_output",
      provenance: JSON.stringify({
        origin_job: jobId,
        content_hash: hash,
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
      count += this.collectFromCronOutput(
        output.jobId,
        output.content,
        jobSchedules.get(output.jobId),
      );
    }
    return count;
  }
}
