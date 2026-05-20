import type { ProfileEngine } from "../profile/engine";
import type { OrchestratorStore } from "./store";
import type { ExecutionResult } from "./types";

export interface ProcessedObservation {
  id: number;
  type: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
}

export class Observer {
  private store: OrchestratorStore;
  private profileEngine: ProfileEngine;

  constructor(store: OrchestratorStore, profileEngine: ProfileEngine) {
    this.store = store;
    this.profileEngine = profileEngine;
  }

  processResult(result: ExecutionResult): ProcessedObservation[] {
    const observations: ProcessedObservation[] = [];
    const task = this.store.getTask(result.task_id);

    // Task completion observation
    observations.push(
      this.emitObservation(
        "behavior",
        `execution:task_completion:${result.task_id}`,
        JSON.stringify({
          success: result.success,
          duration_ms: result.duration_ms,
        }),
        result.success ? 7 : 4,
      ),
    );

    // Duration observation
    observations.push(
      this.emitObservation(
        "behavior",
        `execution:duration:${result.task_id}`,
        JSON.stringify({ duration_ms: result.duration_ms }),
        5,
      ),
    );

    // Domain observation (if task found)
    if (task) {
      const idea = this.store.getIdea(task.idea_id);
      if (idea) {
        const results = this.store.getResultsByIdea(idea.id);
        const completed = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        observations.push(
          this.emitObservation(
            "signal",
            `execution:domain:${idea.domain}`,
            JSON.stringify({ completed, failed, total: results.length }),
            5,
          ),
        );
      }
      this.store.updateTaskStatus(
        task.id,
        result.success ? "completed" : "failed",
      );
    }

    return observations;
  }

  processFeedback(resultId: number, feedback: string): ProcessedObservation[] {
    this.store.addUserFeedback(resultId, feedback);
    const observations: ProcessedObservation[] = [];
    observations.push(
      this.emitObservation(
        "feedback",
        `execution:feedback:result-${resultId}`,
        JSON.stringify({ text: feedback }),
        6,
      ),
    );
    return observations;
  }

  processAllResults(ideaId: string): ProcessedObservation[] {
    const results = this.store.getResultsByIdea(ideaId);
    const allObs: ProcessedObservation[] = [];
    for (const result of results) {
      allObs.push(...this.processResult(result));
    }
    return allObs;
  }

  getProfileUpdates(since: string): Array<{
    dimension: string;
    value: number;
    confidence: number;
    changedAt: string;
  }> {
    const traits = this.profileEngine.getTraits();
    return traits
      .filter((t) => t.updated_at >= since)
      .map((t) => ({
        dimension: t.dimension,
        value: t.value,
        confidence: t.confidence,
        changedAt: t.updated_at,
      }));
  }

  private emitObservation(
    type: string,
    key: string,
    value: string,
    confidence: number,
  ): ProcessedObservation {
    const id = this.profileEngine.addObservation({
      type: type as "behavior" | "signal" | "feedback",
      key,
      value,
      confidence,
      source: "execution_result",
      provenance: JSON.stringify({
        source: "orchestrator_observer",
        extracted_at: new Date().toISOString(),
      }),
    });
    return { id, type, key, value, confidence, source: "execution_result" };
  }
}
