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

  private getPendingDir(): string {
    const pendingDir = join(this.baseDir, "cron", "pending");
    if (!existsSync(pendingDir)) mkdirSync(pendingDir, { recursive: true });
    return pendingDir;
  }

  async dispatchOneOff(
    taskId: string,
    agent: string,
    prompt: string,
  ): Promise<DispatchResult> {
    const pendingDir = this.getPendingDir();
    const jobFile = join(pendingDir, `${taskId}.json`);
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
    const pendingDir = this.getPendingDir();
    const jobFile = join(pendingDir, `${taskId}.json`);
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
    const pendingDir = this.getPendingDir();
    const jobFile = join(pendingDir, `${taskId}.json`);
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
    return files.map((f) => {
      const content = JSON.parse(readFileSync(join(pendingDir, f), "utf-8"));
      return {
        id: content.id,
        type: content.type,
        schedule: content.schedule,
        prompt: content.prompt,
      };
    });
  }
}
