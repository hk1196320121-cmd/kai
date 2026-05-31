import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DispatchResult {
  success: boolean;
  agent: string;
  jobId?: string;
  error?: string;
  retryable?: boolean;
  /** Captured stdout for synchronous bridges (e.g. ClaudeCodeBridge). Undefined for async bridges (HermesAgentBridge). */
  output?: string;
}

export interface AgentBridge {
  dispatchOneOff(
    taskId: string,
    agent: string,
    prompt: string,
  ): Promise<DispatchResult>;
  scheduleCron(
    taskId: string,
    schedule: string,
    prompt: string,
  ): Promise<DispatchResult>;
  cancelCron(taskId: string): Promise<boolean>;
  listPending(): Promise<
    Array<{ id: string; type: string; schedule?: string; prompt: string }>
  >;
}

export class HermesAgentBridge implements AgentBridge {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".hermes");
  }

  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private getPendingDir(): string {
    const pendingDir = join(this.baseDir, "cron", "pending");
    mkdirSync(pendingDir, { recursive: true });
    return pendingDir;
  }

  async dispatchOneOff(
    taskId: string,
    agent: string,
    prompt: string,
  ): Promise<DispatchResult> {
    const safeId = this.sanitizeId(taskId);
    const pendingDir = this.getPendingDir();
    const jobFile = join(pendingDir, `${safeId}.json`);
    writeFileSync(
      jobFile,
      JSON.stringify({
        id: taskId,
        type: "one_off",
        agent,
        prompt,
        created_at: new Date().toISOString(),
      }),
    );
    return { success: true, agent, jobId: taskId };
  }

  async scheduleCron(
    taskId: string,
    schedule: string,
    prompt: string,
  ): Promise<DispatchResult> {
    const safeId = this.sanitizeId(taskId);
    const pendingDir = this.getPendingDir();
    const jobFile = join(pendingDir, `${safeId}.json`);
    writeFileSync(
      jobFile,
      JSON.stringify({
        id: taskId,
        type: "cron",
        schedule,
        prompt,
        created_at: new Date().toISOString(),
      }),
    );
    return { success: true, agent: "hermes", jobId: taskId };
  }

  async cancelCron(taskId: string): Promise<boolean> {
    const safeId = this.sanitizeId(taskId);
    const pendingDir = this.getPendingDir();
    const jobFile = join(pendingDir, `${safeId}.json`);
    if (existsSync(jobFile)) {
      unlinkSync(jobFile);
      return true;
    }
    return false;
  }

  async listPending(): Promise<
    Array<{ id: string; type: string; schedule?: string; prompt: string }>
  > {
    const pendingDir = this.getPendingDir();
    if (!existsSync(pendingDir)) return [];
    const files = readdirSync(pendingDir).filter((f) => f.endsWith(".json"));
    const results: Array<{
      id: string;
      type: string;
      schedule?: string;
      prompt: string;
    }> = [];
    for (const f of files) {
      try {
        const content = JSON.parse(readFileSync(join(pendingDir, f), "utf-8"));
        results.push({
          id: content.id,
          type: content.type,
          schedule: content.schedule,
          prompt: content.prompt,
        });
      } catch {
        // Skip corrupted files
      }
    }
    return results;
  }
}
