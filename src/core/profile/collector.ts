import { ProfileEngine } from "./engine";
import { HermesBridge } from "../../bridge/hermes";
import { createHash } from "crypto";

export class ProfileCollector {
  private engine: ProfileEngine;
  private bridge: HermesBridge;

  constructor(engine: ProfileEngine, bridge: HermesBridge) {
    this.engine = engine;
    this.bridge = bridge;
  }

  collectFromCronOutput(jobId: string, content: string): number {
    const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);

    // Dedup: check if we already collected this exact content
    const existing = this.engine.getObservations({ key: `cron:${jobId}:${contentHash}` });
    if (existing.length > 0) return 0;

    const id = this.engine.addObservation({
      type: "behavior",
      key: `cron:${jobId}:${contentHash}`,
      value: JSON.stringify({ jobId, contentPreview: content.slice(0, 200), contentLength: content.length }),
      confidence: 5,
      source: "cron_output",
      provenance: JSON.stringify({
        origin_job: jobId,
        content_hash: contentHash,
        extracted_at: new Date().toISOString(),
        extractor_version: "0.1.0",
      }),
    });
    return id > 0 ? 1 : 0;
  }

  collectDaily(): number {
    const outputs = this.bridge.getAllCronOutputs();
    let count = 0;
    for (const output of outputs) {
      count += this.collectFromCronOutput(output.jobId, output.content);
    }
    return count;
  }
}
