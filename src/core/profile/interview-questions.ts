export interface InterviewQuestion {
  slug: string;
  prompt: string;
  required: boolean;
  traitTarget?: string;
  options?: string[];
}

export const QUESTIONS: InterviewQuestion[] = [
  {
    slug: "goal",
    prompt: "What are you trying to get done?",
    required: true,
  },
  {
    slug: "success",
    prompt: "What would a good result look like?",
    required: false,
  },
  {
    slug: "constraints",
    prompt: "Any constraints — people, tools, deadlines?",
    required: false,
  },
  {
    slug: "domain",
    prompt: "What kind of work do you mostly do?",
    required: false,
    options: [
      "engineering",
      "design",
      "management",
      "research",
      "writing",
      "other",
    ],
  },
  {
    slug: "planning_style",
    prompt: "How do you approach a new project?",
    required: false,
    traitTarget: "planning_style",
    options: ["detailed plan", "rough outline", "explore first", "dive right in"],
  },
  {
    slug: "schedule_rhythm",
    prompt: "When are you most productive?",
    required: false,
    traitTarget: "schedule_rhythm",
    options: ["morning", "afternoon", "evening", "late night", "flexible"],
  },
  {
    slug: "preferred_output_shape",
    prompt: "How should Kai organize your work?",
    required: false,
    traitTarget: "preferred_output_shape",
    options: ["checklist", "brief", "plan", "decision log"],
  },
  {
    slug: "risk_tolerance",
    prompt: "How do you feel about trying unproven approaches?",
    required: false,
    traitTarget: "risk_tolerance",
    options: [
      "only when confident",
      "after basic testing",
      "when it compiles",
    ],
  },
  {
    slug: "autonomy",
    prompt: "How much should Kai act on its own?",
    required: false,
    traitTarget: "autonomy",
    options: ["ask every time", "suggest only", "act autonomously"],
  },
  {
    slug: "disliked_behavior",
    prompt: "What AI behavior would annoy you most?",
    required: false,
    traitTarget: "disliked_behavior",
    options: [
      "acts without asking",
      "too verbose",
      "too cautious",
      "asks too many questions",
      "ignores context",
    ],
  },
];
