import { describe, test, expect } from "bun:test";
import type {
  Idea,
  PlannedTask,
  ExecutionResult,
  ExecutionObservation,
  IdeaStatus,
  TaskType,
  TaskStatus,
} from "../../../src/core/orchestrator/types";

describe("Orchestrator Types", () => {
  test("Idea has all required fields", () => {
    const idea: Idea = {
      id: "test-id",
      title: "Learn Rust",
      description: "Build a CLI tool in Rust",
      domain: "coding",
      priority: "high",
      deadline: "2026-06-01",
      status: "draft",
      workspace_id: "ws-1",
      created_at: "2026-05-20T00:00:00Z",
      updated_at: "2026-05-20T00:00:00Z",
    };
    expect(idea.id).toBe("test-id");
    expect(idea.domain).toBe("coding");
  });

  test("PlannedTask supports one_off and cron types", () => {
    const oneOff: PlannedTask = {
      id: "task-1",
      idea_id: "idea-1",
      workspace_id: "ws-1",
      title: "Set up project",
      description: "Initialize Cargo project",
      type: "one_off",
      agent: "hermes",
      prompt: "Run: cargo init my-cli",
      decomposition_rationale: "First step in Rust learning",
      scheduling_rationale: "No scheduling needed for one-off",
      status: "pending",
      retry_count: 0,
      max_retries: 2,
      created_at: "2026-05-20T00:00:00Z",
      updated_at: "2026-05-20T00:00:00Z",
    };
    expect(oneOff.type).toBe("one_off");

    const cron: PlannedTask = {
      ...oneOff,
      id: "task-2",
      type: "cron",
      cron_schedule: "0 9 * * 1-5",
      cron_prompt: "Practice Rust for 30 minutes",
      prompt: "Practice Rust for 30 minutes",
    };
    expect(cron.type).toBe("cron");
    expect(cron.cron_schedule).toBe("0 9 * * 1-5");
  });

  test("ExecutionResult captures agent output", () => {
    const result: ExecutionResult = {
      id: 1,
      task_id: "task-1",
      agent: "hermes",
      success: true,
      output: "Project initialized successfully",
      duration_ms: 1500,
      user_feedback: "Looks good",
      completed_at: "2026-05-20T01:00:00Z",
    };
    expect(result.success).toBe(true);
    expect(result.duration_ms).toBe(1500);
  });

  test("ExecutionObservation maps to profile dimensions", () => {
    const obs: ExecutionObservation = {
      dimension: "persistence",
      signal: "Completed all 5 tasks in the plan",
      confidence: 7,
      source: "execution_result",
    };
    expect(obs.source).toBe("execution_result");
    expect(obs.confidence).toBeGreaterThanOrEqual(1);
    expect(obs.confidence).toBeLessThanOrEqual(10);
  });
});
