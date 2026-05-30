export interface Rule {
  dimension: string;
  match: (key: string, value: string) => boolean;
  derive: (matches: number) => {
    value: number;
    confidence: number;
    reasoning: string;
  };
  deriveFromValues?: (
    matches: number,
    values: string[],
  ) => {
    value: number;
    confidence: number;
    reasoning: string;
  };
}

function deriveFromAnswerMap(
  count: number,
  values: string[],
  answerMap: Record<string, number>,
  dimensionLabel: string,
): { value: number; confidence: number; reasoning: string } {
  let total = 0;
  let matched = 0;
  const matchedAnswers: string[] = [];
  for (const v of values) {
    try {
      const parsed = JSON.parse(v);
      const answer = String(parsed.answer ?? "").toLowerCase();
      if (answerMap[answer] !== undefined) {
        total += answerMap[answer];
        matched++;
        matchedAnswers.push(answer);
      }
    } catch {
      /* skip */
    }
  }
  if (matched === 0) {
    return {
      value: 0.5,
      confidence: 3,
      reasoning: `Cold start: ${count} ${dimensionLabel} signals (no direct match)`,
    };
  }
  const avg = total / matched;
  const answerDetail =
    matchedAnswers.length > 0 ? ` [${matchedAnswers.join(", ")}]` : "";
  return {
    value: Math.round(avg * 100) / 100,
    confidence: 8,
    reasoning: `Cold start: ${dimensionLabel} from ${matched} answer(s)${answerDetail}, avg=${avg.toFixed(2)}`,
  };
}

export const RULES: Rule[] = [
  {
    dimension: "early_riser",
    match: (_key, value) => {
      try {
        const v = JSON.parse(value);
        return v.hour !== undefined && v.hour >= 5 && v.hour <= 8;
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, count * 0.1),
      confidence: Math.min(10, count),
      reasoning: `Observed ${count} morning activities (5-8am)`,
    }),
  },
  {
    dimension: "tinkerer",
    match: (key, value) => {
      try {
        const v = JSON.parse(value);
        const isActivityKey = key.startsWith("cron:") || key.startsWith("mcp:");
        return (
          isActivityKey &&
          typeof v.contentLength === "number" &&
          v.contentLength > 0
        );
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, count * 0.12),
      confidence: Math.min(10, count),
      reasoning: `Has ${count} distinct cron output entries (frequent task tinkerer)`,
    }),
  },
  {
    dimension: "consistent_user",
    match: (key) => key.startsWith("cron:"),
    derive: (count) => ({
      value: Math.min(1.0, count * 0.05),
      confidence: Math.min(10, Math.floor(count / 2)),
      reasoning: `Ran ${count} cron tasks`,
    }),
  },
  {
    dimension: "detail_oriented",
    match: (key, value) => {
      if (!key.startsWith("mcp:")) return false;
      try {
        const v = JSON.parse(value);
        const text = (v.text ?? "").toLowerCase();
        return (
          text.includes("detail") ||
          text.includes("thorough") ||
          text.includes("exhaustive") ||
          text.includes("careful")
        );
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.3 + count * 0.15),
      confidence: Math.min(10, 3 + count),
      reasoning: `MCP observation suggests detail orientation (${count} signals)`,
    }),
  },
  {
    dimension: "scope_appetite",
    match: (key, value) => {
      if (!key.startsWith("mcp:")) return false;
      try {
        const v = JSON.parse(value);
        const text = (v.text ?? "").toLowerCase();
        return (
          text.includes("ambitious") ||
          text.includes("big project") ||
          text.includes("scope") ||
          text.includes("large")
        );
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.3 + count * 0.2),
      confidence: Math.min(10, 2 + count),
      reasoning: `MCP observation suggests large scope appetite (${count} signals)`,
    }),
  },
  {
    dimension: "risk_tolerance",
    match: (key, value) => {
      if (!key.startsWith("mcp:")) return false;
      try {
        const v = JSON.parse(value);
        const text = (v.text ?? "").toLowerCase();
        return (
          text.includes("risk") ||
          text.includes("experiment") ||
          text.includes("try new") ||
          text.includes("cutting edge")
        );
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.3 + count * 0.2),
      confidence: Math.min(10, 2 + count),
      reasoning: `MCP observation suggests risk tolerance (${count} signals)`,
    }),
  },
  {
    dimension: "detail_oriented",
    match: (key, value) => {
      if (key !== "coldstart:signal.detail_level") return false;
      try {
        const v = JSON.parse(value);
        return v.level === "high";
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.5 + count * 0.15),
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} high-detail signals detected`,
    }),
  },
  {
    dimension: "comm_style",
    match: (key) => key === "coldstart:signal.comm_style",
    derive: (count) => ({
      value: Math.min(1.0, count * 0.2),
      confidence: Math.min(10, 3 + count * 2),
      reasoning: `Cold start: ${count} communication style signals`,
    }),
  },
  {
    dimension: "domain_context",
    match: (key) => key === "coldstart:signal.domain",
    derive: (count) => ({
      value: Math.min(1.0, count * 0.25),
      confidence: Math.min(10, 4 + count * 2),
      reasoning: `Cold start: ${count} domain context signals`,
    }),
  },
  {
    dimension: "domain_context",
    match: (key) => key === "coldstart:domain",
    derive: (count) => ({
      value: 0.8,
      confidence: 9,
      reasoning: `Cold start: ${count} explicit domain selection(s)`,
    }),
  },
  {
    dimension: "early_riser",
    match: (key, value) => {
      if (key !== "coldstart:git.commit_time_distribution") return false;
      try {
        const v = JSON.parse(value);
        return v.morning_ratio > 0.3;
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.4 + count * 0.15),
      confidence: Math.min(10, 4 + count),
      reasoning: `Git scan: ${count} high morning commit ratio signals`,
    }),
  },
  {
    dimension: "detail_oriented",
    match: (key, value) => {
      if (key !== "coldstart:git.commit_message_length") return false;
      try {
        const v = JSON.parse(value);
        return v.detail_level === "high";
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.4 + count * 0.15),
      confidence: Math.min(10, 4 + count),
      reasoning: `Git scan: ${count} long commit message signals`,
    }),
  },
  {
    dimension: "scope_appetite",
    match: (key, value) => {
      if (key !== "coldstart:git.branch_pattern") return false;
      try {
        const v = JSON.parse(value);
        return v.structured === true;
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.3 + count * 0.2),
      confidence: Math.min(10, 3 + count),
      reasoning: `Git scan: ${count} structured branch naming signals`,
    }),
  },
  {
    dimension: "task_completion_rate",
    match: (key) => key.startsWith("workspace:task_"),
    derive: (count) => ({
      value: Math.min(1.0, count * 0.15),
      confidence: Math.min(10, count),
      reasoning: `${count} workspace task events recorded`,
    }),
  },
  {
    dimension: "planning_style",
    match: (key) => key === "coldstart:planning_style",
    derive: (count) => ({
      value: 0.5,
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} planning style signals (fallback count-based)`,
    }),
    deriveFromValues: (count, values) =>
      deriveFromAnswerMap(
        count,
        values,
        {
          "detailed plan": 0.9,
          "rough outline": 0.6,
          "dive right in": 0.2,
          "explore first": 0.4,
        },
        "planning style",
      ),
  },
  {
    dimension: "schedule_rhythm",
    match: (key) => key === "coldstart:schedule_rhythm",
    derive: (count) => ({
      value: 0.5,
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} schedule rhythm signals (fallback)`,
    }),
    deriveFromValues: (count, values) =>
      deriveFromAnswerMap(
        count,
        values,
        {
          morning: 0.9,
          afternoon: 0.5,
          evening: 0.3,
          "late night": 0.2,
          flexible: 0.5,
        },
        "schedule rhythm",
      ),
  },
  {
    dimension: "preferred_output_shape",
    match: (key) => key === "coldstart:preferred_output_shape",
    derive: (count) => ({
      value: 0.5,
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} output shape signals (fallback)`,
    }),
    deriveFromValues: (count, values) =>
      deriveFromAnswerMap(
        count,
        values,
        {
          checklist: 0.9,
          brief: 0.6,
          plan: 0.3,
          "decision log": 0.1,
        },
        "output shape",
      ),
  },
  {
    dimension: "disliked_behavior",
    match: (key) => key === "coldstart:disliked_behavior",
    derive: (count) => ({
      value: Math.min(1.0, count * 0.3),
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} disliked behavior signals (count-based)`,
    }),
    deriveFromValues: (count, values) => {
      const patterns: Record<string, string> = {
        "acts without asking": "autonomy_violation",
        "too verbose": "verbosity",
        "too cautious": "overcaution",
        "asks too many questions": "question_overload",
        "ignores context": "context_blindness",
      };
      const detected: string[] = [];
      for (const v of values) {
        try {
          const parsed = JSON.parse(v);
          const answer = String(parsed.answer ?? "").toLowerCase();
          for (const [pattern, label] of Object.entries(patterns)) {
            if (answer.includes(pattern)) detected.push(label);
          }
        } catch {
          /* skip */
        }
      }
      if (detected.length === 0) {
        return {
          value: count * 0.3,
          confidence: 5,
          reasoning: `Cold start: ${count} generic disliked behavior signals`,
        };
      }
      return {
        value: Math.min(1.0, detected.length * 0.4),
        confidence: 8,
        reasoning: `Cold start: dislikes [${detected.join(", ")}]`,
      };
    },
  },
  {
    dimension: "risk_tolerance",
    match: (key) => key === "coldstart:risk_tolerance",
    derive: (count) => ({
      value: 0.5,
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} risk tolerance signals (fallback)`,
    }),
    deriveFromValues: (count, values) =>
      deriveFromAnswerMap(
        count,
        values,
        {
          "only when confident": 0.2,
          "after basic testing": 0.5,
          "when it compiles": 0.9,
        },
        "risk tolerance",
      ),
  },
  {
    dimension: "autonomy",
    match: (key) => key === "coldstart:autonomy",
    derive: (count) => ({
      value: 0.5,
      confidence: Math.min(10, 5 + count),
      reasoning: `Cold start: ${count} autonomy signals (fallback)`,
    }),
    deriveFromValues: (count, values) =>
      deriveFromAnswerMap(
        count,
        values,
        {
          "ask every time": 0.2,
          "suggest only": 0.5,
          "act autonomously": 0.9,
        },
        "autonomy",
      ),
  },
  {
    dimension: "autonomy",
    match: (_key, value) => {
      try {
        const v = JSON.parse(value);
        return v.tool === "Bash";
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.4 + count * 0.1),
      confidence: Math.min(10, 3 + count),
      reasoning: `Autopilot: ${count} Bash tool_usage signals (direct execution)`,
    }),
  },
  {
    dimension: "detail_oriented",
    match: (_key, value) => {
      try {
        const v = JSON.parse(value);
        return v.tool === "Edit";
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.3 + count * 0.1),
      confidence: Math.min(10, 3 + count),
      reasoning: `Autopilot: ${count} Edit tool_usage signals (precise edits)`,
    }),
  },
  {
    dimension: "exploratory",
    match: (_key, value) => {
      try {
        const v = JSON.parse(value);
        return ["Grep", "Glob", "WebSearch"].includes(v.tool);
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.2 + count * 0.1),
      confidence: Math.min(10, 2 + count),
      reasoning: `Search/exploration tool usage (${count} uses)`,
    }),
  },
  {
    dimension: "code_focus",
    match: (_key, value) => {
      try {
        const v = JSON.parse(value);
        return ["Edit", "Write", "Read"].includes(v.tool);
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.3 + count * 0.06),
      confidence: Math.min(10, 3 + count),
      reasoning: `Code editing tools used ${count} times`,
    }),
  },
  {
    dimension: "planning_style",
    match: (_key, value) => {
      try {
        const v = JSON.parse(value);
        return v.tool === "TodoRead" || v.tool === "TodoWrite";
      } catch {
        return false;
      }
    },
    derive: (count) => ({
      value: Math.min(1.0, 0.5 + count * 0.1),
      confidence: Math.min(10, 4 + count),
      reasoning: `Task management usage suggests structured planning (${count} uses)`,
    }),
  },
];
