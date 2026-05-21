import type { ProfileEngine } from "../profile/engine";
import type { TelemetryRecorder } from "../telemetry/recorder";
import type { OrchestratorStore } from "./store";
import type { ExecutionResult, Idea, PlannedTask } from "./types";

/** Observation confidence for a successful task completion (1-10 scale) */
const OBSERVATION_CONFIDENCE_SUCCESS = 7;
/** Observation confidence for a failed task completion (1-10 scale) */
const OBSERVATION_CONFIDENCE_FAILURE = 4;
/** Observation confidence for duration metrics (1-10 scale) */
const OBSERVATION_CONFIDENCE_DURATION = 5;
/** Observation confidence for user feedback (1-10 scale) */
const OBSERVATION_CONFIDENCE_FEEDBACK = 6;

/** Valid observation types for emitObservation */
const OBSERVATION_TYPES = ["behavior", "signal", "feedback"] as const;
type ObservationType = (typeof OBSERVATION_TYPES)[number];

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
  private telemetry: TelemetryRecorder | null;

  constructor(
    store: OrchestratorStore,
    profileEngine: ProfileEngine,
    telemetry: TelemetryRecorder | null = null,
  ) {
    this.store = store;
    this.profileEngine = profileEngine;
    this.telemetry = telemetry;
  }

  processResult(
    result: ExecutionResult,
    prefetched?: {
      task: PlannedTask | null;
      idea: Idea | null;
      ideaResults: ExecutionResult[];
    },
  ): ProcessedObservation[] {
    const trace = this.telemetry?.startTrace(
      "internal",
      "observer.processResult",
    );
    const span = trace?.startSpan("task_exec", "process execution result");

    const observations: ProcessedObservation[] = [];
    const task = prefetched?.task ?? this.store.getTask(result.task_id);

    // Task completion observation
    observations.push(
      this.emitObservation(
        "behavior",
        `execution:task_completion:${result.task_id}`,
        JSON.stringify({
          success: result.success,
          duration_ms: result.duration_ms,
        }),
        result.success
          ? OBSERVATION_CONFIDENCE_SUCCESS
          : OBSERVATION_CONFIDENCE_FAILURE,
      ),
    );

    // Duration observation
    observations.push(
      this.emitObservation(
        "behavior",
        `execution:duration:${result.task_id}`,
        JSON.stringify({ duration_ms: result.duration_ms }),
        OBSERVATION_CONFIDENCE_DURATION,
      ),
    );

    // Domain observation (if task found)
    if (task) {
      const idea = prefetched?.idea ?? this.store.getIdea(task.idea_id);
      if (idea) {
        const ideaResults =
          prefetched?.ideaResults ?? this.store.getResultsByIdea(idea.id);
        const completed = ideaResults.filter((r) => r.success).length;
        const failed = ideaResults.filter((r) => !r.success).length;
        observations.push(
          this.emitObservation(
            "signal",
            `execution:domain:${idea.domain}`,
            JSON.stringify({ completed, failed, total: ideaResults.length }),
            5,
          ),
        );
      }
      this.store.updateTaskStatus(
        task.id,
        result.success ? "completed" : "failed",
      );
    }

    span?.end("ok");
    trace?.end("completed");
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
        OBSERVATION_CONFIDENCE_FEEDBACK,
      ),
    );
    return observations;
  }

  processAllResults(ideaId: string): ProcessedObservation[] {
    const results = this.store.getResultsByIdea(ideaId);
    const idea = this.store.getIdea(ideaId);
    const tasks = this.store.getTasksByIdea(ideaId);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const allObs: ProcessedObservation[] = [];
    for (const result of results) {
      const task = taskMap.get(result.task_id) ?? null;
      allObs.push(
        ...this.processResult(result, { task, idea, ideaResults: results }),
      );
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
    type: ObservationType,
    key: string,
    value: string,
    confidence: number,
  ): ProcessedObservation {
    const id = this.profileEngine.addObservation({
      type,
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
