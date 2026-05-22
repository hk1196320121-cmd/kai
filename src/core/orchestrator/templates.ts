import type { IdeaDomain } from "./types";

export interface TaskTemplate {
  id: string;
  title: string;
  description: string;
  prompt: string;
  domain: IdeaDomain;
  agent: "hermes" | "openclaw" | "auto";
  trait_targets: Record<string, number>;
}

export interface ScoredRecommendation {
  template: TaskTemplate;
  score: number;
  matchedTraits: string[];
}

export const TEMPLATE_CATALOG: TaskTemplate[] = [
  {
    id: "daily-standup",
    title: "Daily Standup Generator",
    description:
      "Generate a daily standup report from git activity and task status",
    prompt:
      "Generate a daily standup report covering: what was done yesterday (from git log), what's planned today, and any blockers. Format as a concise 3-bullet summary.",
    domain: "coding",
    agent: "hermes",
    trait_targets: { detail_oriented: 0.7, planning_style: 0.6 },
  },
  {
    id: "code-review-checklist",
    title: "Code Review Checklist",
    description:
      "Generate a code review checklist tailored to your project patterns",
    prompt:
      "Create a code review checklist for the most recent pull request. Cover: correctness, edge cases, error handling, test coverage, and performance.",
    domain: "coding",
    agent: "hermes",
    trait_targets: { detail_oriented: 0.8, risk_tolerance: 0.3 },
  },
  {
    id: "bug-triage",
    title: "Bug Triage Prioritizer",
    description: "Prioritize bugs by impact and urgency using project context",
    prompt:
      "Analyze open issues/bugs and prioritize them by: user impact, frequency, and fix complexity. Produce a ranked list with rationale.",
    domain: "coding",
    agent: "hermes",
    trait_targets: { planning_style: 0.7, risk_tolerance: 0.5 },
  },
  {
    id: "api-design-review",
    title: "API Design Reviewer",
    description: "Review API designs for consistency, security, and usability",
    prompt:
      "Review the API design for: naming consistency, HTTP method usage, error response format, pagination patterns, and authentication scope.",
    domain: "coding",
    agent: "hermes",
    trait_targets: { detail_oriented: 0.9, planning_style: 0.8 },
  },
  {
    id: "research-digest",
    title: "Weekly Research Digest",
    description:
      "Summarize research papers, articles, and findings from the week",
    prompt:
      "Compile a weekly research digest: summarize key findings, highlight actionable insights, and note connections to ongoing work.",
    domain: "research",
    agent: "hermes",
    trait_targets: { detail_oriented: 0.6 },
  },
  {
    id: "writing-outline",
    title: "Document Outliner",
    description:
      "Generate structured outlines for documents, blog posts, or reports",
    prompt:
      "Create a detailed outline for the writing project. Include: sections, key points per section, and a flow that builds a coherent narrative.",
    domain: "writing",
    agent: "hermes",
    trait_targets: { planning_style: 0.8, preferred_output_shape: 0.3 },
  },
  {
    id: "sprint-planner",
    title: "Sprint Planning Assistant",
    description: "Break down goals into sprint-sized tasks with estimates",
    prompt:
      "Decompose the sprint goal into tasks with: description, estimated effort (S/M/L), dependencies, and suggested assignee based on expertise.",
    domain: "management",
    agent: "hermes",
    trait_targets: { planning_style: 0.9, detail_oriented: 0.7 },
  },
  {
    id: "design-system-audit",
    title: "Design System Auditor",
    description: "Audit a design system for consistency and completeness",
    prompt:
      "Audit the design system for: color consistency, typography scale, spacing system, component coverage, and accessibility compliance.",
    domain: "creative",
    agent: "hermes",
    trait_targets: { detail_oriented: 0.9 },
  },
  {
    id: "learning-path",
    title: "Personal Learning Path",
    description:
      "Generate a structured learning plan based on goals and current skills",
    prompt:
      "Create a learning path: assess current knowledge, identify gaps, recommend resources (ordered by difficulty), and suggest practice projects.",
    domain: "general",
    agent: "hermes",
    trait_targets: { planning_style: 0.7 },
  },
  {
    id: "meeting-notes",
    title: "Meeting Notes Formatter",
    description:
      "Transform raw meeting notes into structured action items and decisions",
    prompt:
      "Format the meeting notes into: attendees, key decisions (with rationale), action items (with owner and deadline), and open questions.",
    domain: "general",
    agent: "hermes",
    trait_targets: { preferred_output_shape: 0.9 },
  },
  {
    id: "project-retrospective",
    title: "Project Retrospective Guide",
    description:
      "Run a structured retrospective on a completed project or sprint",
    prompt:
      "Guide a retrospective covering: what went well, what could improve, and actionable changes for next time. Use the Start-Stop-Continue framework.",
    domain: "management",
    agent: "hermes",
    trait_targets: {},
  },
  {
    id: "weekly-review",
    title: "Weekly Review Generator",
    description:
      "Compile a weekly review from tasks completed, observations, and goals",
    prompt:
      "Generate a weekly review: tasks completed, metrics changed, patterns noticed, and suggestions for next week. Include profile evolution summary.",
    domain: "general",
    agent: "hermes",
    trait_targets: {},
  },
];

export function matchTemplates(
  traits: { dimension: string; value: number; confidence: number }[],
  domain: IdeaDomain,
): ScoredRecommendation[] {
  const traitMap = new Map(traits.map((t) => [t.dimension, t.value]));

  const scored: ScoredRecommendation[] = TEMPLATE_CATALOG.map((template) => {
    const targets = template.trait_targets;
    const targetEntries = Object.entries(targets);

    if (targetEntries.length === 0) {
      return { template, score: 0.5, matchedTraits: [] };
    }

    let totalWeight = 0;
    let totalScore = 0;
    const matchedTraits: string[] = [];

    for (const [dim, targetValue] of targetEntries) {
      const userValue = traitMap.get(dim) ?? 0.5;
      const distance = Math.abs(userValue - targetValue);
      const closeness = 1 - distance;
      totalWeight += 1;
      totalScore += closeness;
      if (closeness > 0.6) matchedTraits.push(dim);
    }

    let score = totalScore / totalWeight;

    if (template.domain === domain) {
      score += 0.2;
    }

    score = Math.min(1.0, score);

    return {
      template,
      score: Math.round(score * 100) / 100,
      matchedTraits,
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, 5);
}
