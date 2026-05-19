import type { AgentBridge } from "../../bridge/agent-bridge";
import type { Trait } from "../profile/types";
import type { OrchestratorStore } from "./store";

interface ScheduleResult {
  scheduled: number;
  errors: number;
}

export class Scheduler {
  private store: OrchestratorStore;
  private bridge: AgentBridge;

  constructor(store: OrchestratorStore, bridge: AgentBridge) {
    this.store = store;
    this.bridge = bridge;
  }

  async scheduleTasks(ideaId: string, traits: Trait[]): Promise<ScheduleResult> {
    const tasks = this.store.getTasksByIdea(ideaId);
    const traitMap = new Map(traits.map((t) => [t.dimension, t.value]));
    let scheduled = 0;
    let errors = 0;

    for (const task of tasks) {
      if (task.status !== "pending") continue;
      try {
        if (task.type === "cron") {
          let cronSchedule = task.cron_schedule ?? "0 9 * * *";
          cronSchedule = this.applyTraitAdjustments(cronSchedule, traitMap);
          await this.bridge.scheduleCron(task.id, cronSchedule, task.cron_prompt ?? task.prompt);
        } else {
          await this.bridge.dispatchOneOff(task.id, task.agent, task.prompt);
        }
        this.store.updateTaskStatus(task.id, "scheduled");
        scheduled++;
      } catch {
        errors++;
      }
    }
    return { scheduled, errors };
  }

  async pauseTasks(ideaId: string): Promise<{ paused: number; cancelled: number }> {
    const tasks = this.store.getTasksByIdea(ideaId);
    let paused = 0;
    let cancelled = 0;

    for (const task of tasks) {
      if (task.status === "pending" || task.status === "scheduled" || task.status === "executing") {
        if (task.type === "cron") {
          await this.bridge.cancelCron(task.id);
          cancelled++;
        }
        this.store.updateTaskStatus(task.id, "paused");
        paused++;
      }
    }
    this.store.updateIdeaStatus(ideaId, "paused");
    return { paused, cancelled };
  }

  private applyTraitAdjustments(schedule: string, traitMap: Map<string, number>): string {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length < 2) return schedule;
    const earlyRiser = traitMap.get("early_riser") ?? 0.5;
    if (earlyRiser >= 0.6) {
      const hour = Math.floor(6 + (earlyRiser - 0.6) * 10);
      parts[1] = String(Math.min(9, Math.max(6, hour)));
    } else if (earlyRiser <= 0.4) {
      parts[1] = String(Math.max(19, Math.floor(19 + (0.4 - earlyRiser) * 10)));
    }
    return parts.join(" ");
  }
}
