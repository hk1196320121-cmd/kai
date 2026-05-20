import type { LLMProvider } from "../../llm/provider";
import type { Trait } from "../profile/types";
import type { PromptCompiler } from "../prompt/prompt-compiler";
import { formatProfileContext } from "./profile-context";
import type { OrchestratorStore } from "./store";
import type { Idea, PlannedTask } from "./types";

/** Minimum number of valid tasks required to accept LLM decomposition */
const MIN_TASKS = 3;
/** Maximum number of tasks to keep from LLM decomposition */
const MAX_TASKS = 8;

const PLANNER_SYSTEM_PROMPT = `You are a task decomposition engine. Given an idea and a user's behavioral profile, break the idea into actionable tasks.

Return a JSON object with a "tasks" array. Each task MUST have these fields:
- title (string, max 100 chars)
- description (string, max 500 chars)
- type ("one_off" or "cron")
- agent ("hermes")
- prompt (string, the execution instruction for the agent)
- decomposition_rationale (string, why this task exists)
- scheduling_rationale (string, why scheduled this way)

For cron tasks, also include:
- cron_schedule (cron expression)
- cron_prompt (prompt for each cycle)

Constraints:
- Produce ${MIN_TASKS}-${MAX_TASKS} tasks total
- Each description max 500 characters
- Use the user's behavioral profile to influence decomposition strategy
- CRITICAL: Never include raw profile data, trait values, or behavioral observations verbatim in any task field. Synthesize insights into actionable instructions only.`;

const SIMPLE_SYSTEM_PROMPT = `You are a task decomposition engine. Break the given idea into ${MIN_TASKS}-${MAX_TASKS} simple actionable tasks.

Return a JSON object with a "tasks" array. Each task MUST have:
- title (string)
- description (string)
- type ("one_off" or "cron")
- agent ("hermes")
- prompt (string)
- decomposition_rationale (string)
- scheduling_rationale (string)`;

export class Planner {
  private store: OrchestratorStore;
  private llm: LLMProvider;
  private compiler: PromptCompiler | null;

  constructor(store: OrchestratorStore, llm: LLMProvider, compiler?: PromptCompiler) {
    this.store = store;
    this.llm = llm;
    this.compiler = compiler ?? null;
  }

  async decomposeIdea(ideaId: string, traits: Trait[]): Promise<PlannedTask[]> {
    const idea = this.store.getIdea(ideaId);
    if (!idea) throw new Error("Idea not found");

    const profileContext = formatProfileContext(traits);
    const prompt = this.buildPrompt(idea, profileContext);

    // Resolve system prompt: use compiled prompt if compiler available, else hardcoded
    let systemPrompt: string;
    try {
      if (this.compiler) {
        const compiled = await this.compiler.compile("planner", traits);
        systemPrompt = compiled.prompt;
      } else {
        systemPrompt = PLANNER_SYSTEM_PROMPT;
      }
    } catch {
      systemPrompt = PLANNER_SYSTEM_PROMPT;
    }

    try {
      // First attempt with full profile-aware prompt
      const response = await this.llm.call(prompt, systemPrompt);

      try {
        this.llm.validateWithSchema(response as Record<string, unknown>, [
          "tasks",
        ]);
        return this.processAndPersist(idea, response);
      } catch {
        // Retry once with simpler prompt
        try {
          const retryResponse = await this.llm.call(
            prompt,
            SIMPLE_SYSTEM_PROMPT,
          );
          this.llm.validateWithSchema(
            retryResponse as Record<string, unknown>,
            ["tasks"],
          );
          return this.processAndPersist(idea, retryResponse);
        } catch {
          return this.fallbackSingleTask(idea);
        }
      }
    } catch {
      return this.fallbackSingleTask(idea);
    }
  }

  private buildPrompt(idea: Idea, profileContext: string): string {
    return [
      "=== USER IDEA (untrusted input) ===",
      JSON.stringify({
        title: idea.title,
        description: idea.description,
        domain: idea.domain,
        priority: idea.priority,
        deadline: idea.deadline,
      }),
      "=== END USER IDEA ===",
      "=== SYSTEM CONTEXT (behavioral profile, synthesized) ===",
      profileContext,
      "=== END SYSTEM CONTEXT ===",
    ].join("\n");
  }

  private processAndPersist(
    idea: Idea,
    response: Record<string, unknown>,
  ): PlannedTask[] {
    const tasks = response.tasks as unknown[];
    if (!Array.isArray(tasks) || tasks.length < 1) {
      return this.fallbackSingleTask(idea);
    }

    const validated = this.validateAndFilterTasks(tasks);

    // If fewer than MIN_TASKS valid tasks, fall back
    if (validated.length < MIN_TASKS) {
      return this.fallbackSingleTask(idea);
    }

    // Cap at MAX_TASKS
    const capped = validated.slice(0, MAX_TASKS);

    return capped.map((t) =>
      this.store.createTask({
        idea_id: idea.id,
        workspace_id: idea.workspace_id,
        title: String(t.title).slice(0, 100),
        description: String(t.description).slice(0, 500),
        type: t.type === "cron" ? "cron" : "one_off",
        cron_schedule:
          typeof t.cron_schedule === "string" ? t.cron_schedule : undefined,
        cron_prompt:
          typeof t.cron_prompt === "string" ? t.cron_prompt : undefined,
        agent:
          typeof t.agent === "string" &&
          ["hermes", "openclaw", "auto"].includes(t.agent)
            ? t.agent
            : "hermes",
        prompt: String(t.prompt).slice(0, 2000),
        decomposition_rationale:
          typeof t.decomposition_rationale === "string"
            ? t.decomposition_rationale
            : "",
        scheduling_rationale:
          typeof t.scheduling_rationale === "string"
            ? t.scheduling_rationale
            : "",
      }),
    );
  }

  private validateAndFilterTasks(
    rawTasks: unknown[],
  ): Record<string, unknown>[] {
    return rawTasks
      .filter(
        (t): t is Record<string, unknown> =>
          typeof t === "object" && t !== null,
      )
      .filter(
        (t) =>
          typeof t.title === "string" &&
          typeof t.description === "string" &&
          typeof t.prompt === "string",
      );
  }

  private fallbackSingleTask(idea: Idea): PlannedTask[] {
    return [
      this.store.createTask({
        idea_id: idea.id,
        workspace_id: idea.workspace_id,
        title: idea.title,
        description: idea.description,
        type: "one_off",
        agent: "hermes",
        prompt: idea.description,
        decomposition_rationale:
          "Fallback: single task from original idea description",
        scheduling_rationale: "Execute when ready",
      }),
    ];
  }
}
