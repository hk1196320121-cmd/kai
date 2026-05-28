import type { WorkflowDefinition } from "./types";

export const WORKFLOWS: WorkflowDefinition[] = [
  {
    name: "kai",
    description:
      "Kai behavioral dashboard — personalized insights and recommendations",
    tools: [
      { id: "profile.read", params: { scope: "summary" } },
      { id: "kai_work_recommend", params: { limit: 3 } },
    ],
    profileConditions: [
      {
        trait: "early_riser",
        threshold: 0.7,
        include:
          "## Peak Focus Time\nBased on your early_riser trait, your peak focus window is typically 6-10 AM. Schedule deep work accordingly.",
      },
      {
        trait: "tinkerer",
        threshold: 0.7,
        include:
          "## Experimentation Opportunity\nYour tinkerer trait suggests you enjoy hands-on exploration. Consider trying a new workflow or tool configuration.",
      },
    ],
    emptyProfileFallback:
      "## Welcome to Kai!\nNo profile yet. Run `kai work start` to build your profile, then re-install skills with `kai skills install --force`.",
  },
  {
    name: "kai-profile",
    description:
      "View your full behavioral profile with trait evolution over time",
    tools: [
      { id: "profile.read", params: { scope: "full" } },
      { id: "telemetry.query", params: { sql: "SELECT dimension, value, confidence, reasoning, updated_at FROM traits ORDER BY dimension" } },
    ],
    profileConditions: [
      {
        trait: "early_riser",
        threshold: 0.7,
        include:
          "## Morning Pattern Detected\nYour early_riser trait is above 0.7. Consider scheduling reviews and planning sessions in your morning block.",
      },
      {
        trait: "detail_oriented",
        threshold: 0.7,
        include:
          "## Detail View Mode\nYour detail_oriented trait suggests you prefer comprehensive output. Showing full trait breakdowns with provenance.",
      },
    ],
    emptyProfileFallback:
      "## No Profile Yet\nRun `kai work start` to build your behavioral profile through an interactive session.",
  },
  {
    name: "kai-observe",
    description:
      "Submit behavioral observations to the profile engine",
    tools: [
      { id: "observe.submit" },
      { id: "observe.batch" },
    ],
    profileConditions: [],
  },
  {
    name: "kai-why",
    description:
      "Explain why a specific behavioral trait has its current value",
    tools: [{ id: "profile.why" }],
    profileConditions: [
      {
        trait: "domain_context",
        threshold: 0.6,
        include:
          "## Domain-Aware Explanation\nYour domain context is established. Explanations will reference domain-specific patterns.",
      },
    ],
    emptyProfileFallback:
      "## No Profile Yet\nSubmit some observations first to build a profile, then ask why your traits hold their current values.",
  },
  {
    name: "kai-plan",
    description:
      "Submit an idea and generate an execution plan",
    tools: [
      { id: "kai_idea_submit" },
      { id: "kai_idea_plan" },
    ],
    profileConditions: [
      {
        trait: "planning_style",
        threshold: 0.7,
        include:
          "## Structured Planning Detected\nYour planning_style suggests you prefer detailed plans. Breaking the idea into granular tasks with clear dependencies.",
      },
    ],
    emptyProfileFallback:
      "## No Profile Yet\nSubmit an idea and we will generate a plan. Your planning style will be refined as your profile grows.",
  },
  {
    name: "kai-status",
    description:
      "Check execution status of ideas and tasks",
    tools: [{ id: "kai_execution_status" }],
    profileConditions: [
      {
        trait: "detail_oriented",
        threshold: 0.7,
        include:
          "## Detailed Status View\nShowing full execution traces and sub-task breakdowns based on your detail preference.",
      },
    ],
    emptyProfileFallback:
      "## No Profile Yet\nSubmit ideas and execute tasks to build a history. Status tracking improves with your profile.",
  },
  {
    name: "kai-reflect",
    description:
      "Reflect on your current session and submit observations",
    tools: [
      { id: "telemetry.query", params: { sql: "SELECT tool_name, COUNT(*) as cnt FROM tool_calls WHERE ts > datetime('now', '-1 hour') GROUP BY tool_name ORDER BY cnt DESC" } },
      { id: "observe.batch" },
    ],
    profileConditions: [],
  },
  {
    name: "kai-evolve",
    description:
      "Evolve Kai's prompts based on behavioral outcomes",
    tools: [
      { id: "prompt.compile" },
      { id: "prompt.evolve" },
    ],
    profileConditions: [
      {
        trait: "risk_tolerance",
        threshold: 0.7,
        include:
          "## Aggressive Evolution\nYour risk_tolerance suggests willingness to experiment. Running wider exploration with more mutation rounds.",
      },
    ],
    emptyProfileFallback:
      "## No Profile Yet\nEvolving prompts requires behavioral data. Submit observations to build your profile first.",
  },
];
