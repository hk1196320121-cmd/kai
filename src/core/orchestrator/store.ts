import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { KaiDB } from "../../db/client";
import type {
  ExecutionResult,
  Idea,
  IdeaDomain,
  IdeaPriority,
  IdeaStatus,
  PlannedTask,
  TaskStatus,
} from "./types";

interface CreateIdeaInput {
  title: string;
  description: string;
  domain?: IdeaDomain;
  priority?: IdeaPriority;
  deadline?: string;
  workspace_id: string;
}

interface CreateTaskInput {
  idea_id: string;
  workspace_id: string;
  title: string;
  description: string;
  type: "one_off" | "cron";
  cron_schedule?: string;
  cron_prompt?: string;
  agent: string;
  prompt: string;
  decomposition_rationale: string;
  scheduling_rationale: string;
}

interface AddResultInput {
  task_id: string;
  agent: string;
  success: boolean;
  output: string;
  duration_ms: number;
  user_feedback?: string;
}

export class OrchestratorStore {
  private db: Database;

  constructor(kaiDb: KaiDB) {
    this.db = kaiDb.getDatabase();
  }

  // --- Ideas ---

  createIdea(input: CreateIdeaInput): Idea {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO ideas (id, title, description, domain, priority, deadline, workspace_id, status)
       VALUES ($id, $title, $desc, $domain, $priority, $deadline, $ws, 'draft')`,
      )
      .run({
        $id: id,
        $title: input.title,
        $desc: input.description,
        $domain: input.domain ?? "general",
        $priority: input.priority ?? "medium",
        $deadline: input.deadline ?? null,
        $ws: input.workspace_id,
      });
    return this.getIdea(id) as Idea;
  }

  getIdea(id: string): Idea | null {
    return this.db.query("SELECT * FROM ideas WHERE id = $id").get({
      $id: id,
    }) as Idea | null;
  }

  updateIdeaStatus(id: string, status: IdeaStatus): void {
    this.db
      .query(
        "UPDATE ideas SET status = $status, updated_at = datetime('now') WHERE id = $id",
      )
      .run({ $id: id, $status: status });
  }

  listIdeasByStatus(status: IdeaStatus, limit?: number): Idea[] {
    let sql =
      "SELECT * FROM ideas WHERE status = $status ORDER BY created_at DESC";
    const params: Record<string, string | number> = { $status: status };
    if (limit !== undefined) {
      sql += " LIMIT $limit";
      params.$limit = limit;
    }
    return this.db.query(sql).all(params) as Idea[];
  }

  listIdeasByStatuses(statuses: IdeaStatus[]): Idea[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map((_, i) => `$s${i}`).join(", ");
    const params: Record<string, string> = {};
    for (let i = 0; i < statuses.length; i++) {
      params[`$s${i}`] = statuses[i];
    }
    return this.db
      .query(
        `SELECT * FROM ideas WHERE status IN (${placeholders}) ORDER BY created_at DESC`,
      )
      .all(params) as Idea[];
  }

  listIdeasByWorkspace(workspaceId: string, limit?: number): Idea[] {
    let sql =
      "SELECT * FROM ideas WHERE workspace_id = $ws ORDER BY created_at DESC";
    const params: Record<string, string | number> = { $ws: workspaceId };
    if (limit !== undefined) {
      sql += " LIMIT $limit";
      params.$limit = limit;
    }
    return this.db.query(sql).all(params) as Idea[];
  }

  // --- Planned Tasks ---

  createTask(input: CreateTaskInput): PlannedTask {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO planned_tasks (id, idea_id, workspace_id, title, description, type, cron_schedule, cron_prompt, agent, prompt, decomposition_rationale, scheduling_rationale, status)
       VALUES ($id, $idea, $ws, $title, $desc, $type, $cron, $cronPrompt, $agent, $prompt, $decompR, $schedR, 'pending')`,
      )
      .run({
        $id: id,
        $idea: input.idea_id,
        $ws: input.workspace_id,
        $title: input.title,
        $desc: input.description,
        $type: input.type,
        $cron: input.cron_schedule ?? null,
        $cronPrompt: input.cron_prompt ?? null,
        $agent: input.agent,
        $prompt: input.prompt,
        $decompR: input.decomposition_rationale,
        $schedR: input.scheduling_rationale,
      });
    return this.getTask(id) as PlannedTask;
  }

  getTask(id: string): PlannedTask | null {
    return this.db.query("SELECT * FROM planned_tasks WHERE id = $id").get({
      $id: id,
    }) as PlannedTask | null;
  }

  getTasksByIdea(ideaId: string, limit?: number): PlannedTask[] {
    let sql =
      "SELECT * FROM planned_tasks WHERE idea_id = $idea ORDER BY created_at";
    const params: Record<string, string | number> = { $idea: ideaId };
    if (limit !== undefined) {
      sql += " LIMIT $limit";
      params.$limit = limit;
    }
    return this.db.query(sql).all(params) as PlannedTask[];
  }

  updateTaskStatus(id: string, status: TaskStatus): void {
    this.db
      .query(
        "UPDATE planned_tasks SET status = $status, updated_at = datetime('now') WHERE id = $id",
      )
      .run({ $id: id, $status: status });
  }

  updateTask(
    id: string,
    fields: Partial<
      Pick<
        PlannedTask,
        "title" | "agent" | "prompt" | "cron_schedule" | "type" | "description"
      >
    >,
  ): void {
    const sets: string[] = [];
    const params: Record<string, string | null> = { $id: id };
    if (fields.title !== undefined) {
      sets.push("title = $title");
      params.$title = fields.title;
    }
    if (fields.description !== undefined) {
      sets.push("description = $description");
      params.$description = fields.description;
    }
    if (fields.agent !== undefined) {
      sets.push("agent = $agent");
      params.$agent = fields.agent;
    }
    if (fields.prompt !== undefined) {
      sets.push("prompt = $prompt");
      params.$prompt = fields.prompt;
    }
    if (fields.cron_schedule !== undefined) {
      sets.push("cron_schedule = $cron_schedule");
      params.$cron_schedule = fields.cron_schedule;
    }
    if (fields.type !== undefined) {
      sets.push("type = $type");
      params.$type = fields.type;
    }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    this.db
      .query(`UPDATE planned_tasks SET ${sets.join(", ")} WHERE id = $id`)
      .run(params);
  }

  incrementRetryCount(id: string): void {
    this.db
      .query(
        "UPDATE planned_tasks SET retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = $id",
      )
      .run({ $id: id });
  }

  deleteTask(id: string): void {
    this.db.query("DELETE FROM planned_tasks WHERE id = $id").run({ $id: id });
  }

  // --- Execution Results ---

  private mapResult(row: Record<string, unknown>): ExecutionResult {
    const result = row as unknown as ExecutionResult;
    return {
      ...result,
      success: Boolean(result.success),
    };
  }

  addExecutionResult(input: AddResultInput): ExecutionResult {
    const result = this.db
      .query(
        `INSERT INTO execution_results (task_id, agent, success, output, duration_ms, user_feedback)
       VALUES ($task, $agent, $success, $output, $duration, $feedback)`,
      )
      .run({
        $task: input.task_id,
        $agent: input.agent,
        $success: input.success ? 1 : 0,
        $output: input.output,
        $duration: input.duration_ms,
        $feedback: input.user_feedback ?? null,
      });
    const row = this.db
      .query("SELECT * FROM execution_results WHERE id = $id")
      .get({
        $id: Number(result.lastInsertRowid),
      }) as Record<string, unknown>;
    return this.mapResult(row);
  }

  getResultsByTask(taskId: string): ExecutionResult[] {
    const rows = this.db
      .query(
        "SELECT * FROM execution_results WHERE task_id = $task ORDER BY completed_at DESC",
      )
      .all({ $task: taskId }) as Record<string, unknown>[];
    return rows.map((r) => this.mapResult(r));
  }

  getResultsByTaskIds(taskIds: string[]): ExecutionResult[] {
    if (taskIds.length === 0) return [];
    const placeholders = taskIds.map((_, i) => `$t${i}`).join(", ");
    const params: Record<string, string> = {};
    for (let i = 0; i < taskIds.length; i++) {
      params[`$t${i}`] = taskIds[i];
    }
    const rows = this.db
      .query(
        `SELECT * FROM execution_results WHERE task_id IN (${placeholders}) ORDER BY completed_at DESC`,
      )
      .all(params) as Record<string, unknown>[];
    return rows.map((r) => this.mapResult(r));
  }

  getResultsByIdea(ideaId: string): ExecutionResult[] {
    const rows = this.db
      .query(
        `SELECT er.* FROM execution_results er
       JOIN planned_tasks pt ON er.task_id = pt.id
       WHERE pt.idea_id = $idea
       ORDER BY er.completed_at DESC`,
      )
      .all({ $idea: ideaId }) as Record<string, unknown>[];
    return rows.map((r) => this.mapResult(r));
  }

  addUserFeedback(resultId: number, feedback: string): void {
    this.db
      .query("UPDATE execution_results SET user_feedback = $fb WHERE id = $id")
      .run({ $id: resultId, $fb: feedback });
  }

  // --- Dispatch decision methods ---

  createDispatchDecision(input: {
    id: string;
    task_id: string;
    agent: string;
    confidence: number;
    reasoning: string;
  }): void {
    this.db
      .query(
        `INSERT INTO dispatch_decisions (id, task_id, agent, confidence, reasoning)
         VALUES ($id, $taskId, $agent, $confidence, $reasoning)`,
      )
      .run({
        $id: input.id,
        $taskId: input.task_id,
        $agent: input.agent,
        $confidence: input.confidence,
        $reasoning: input.reasoning,
      });
  }

  getDispatchDecision(id: string): Record<string, unknown> | null {
    return this.db
      .query("SELECT * FROM dispatch_decisions WHERE id = $id")
      .get({ $id: id }) as Record<string, unknown> | null;
  }

  updateDispatchDecision(
    id: string,
    decision: string,
    reason: string | null,
  ): void {
    this.db
      .query(
        `UPDATE dispatch_decisions SET user_decision = $decision, user_reason = $reason WHERE id = $id`,
      )
      .run({ $id: id, $decision: decision, $reason: reason });
  }
}
