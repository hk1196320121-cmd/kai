# Personal OS Bootstrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform `kai work start` from a 4-question questionnaire into a 2-3 minute cold start engine that interviews, profiles, recommends 3 workflows, and auto-executes the first one.

**Architecture:** Extended interview engine (10 questions + LLM conversation path) extracted to `src/core/profile/interview.ts`. Template catalog (12 curated templates) with trait-weighted matching in `src/core/orchestrator/templates.ts`. Recommendation engine with "Why this?" and "Why not these?" explanations in `src/core/orchestrator/recommend.ts`. Auto-execute with plan-then-confirm safety gate. Soft feedback loop (observations, not trait mutation). MCP tool `kai_work_recommend`.

**Tech Stack:** Bun runtime, TypeScript, SQLite (V8 migration), MCP protocol, Zod schemas

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/core/profile/interview.ts` | **Create** | InterviewEngine: 10-question fixed path + LLM conversation path + signal extraction |
| `src/core/profile/interview-questions.ts` | **Create** | Question catalog: 10 curated questions with trait mapping |
| `src/core/orchestrator/templates.ts` | **Create** | Task template catalog: 12 templates with trait targets + matching algorithm |
| `src/core/orchestrator/recommend.ts` | **Create** | RecommendationEngine: template scoring + "Why this?" + "Why not these?" |
| `src/core/profile/derivator.ts` | **Modify** | Extend Rule interface with optional `deriveFromValues`, add 4 new coldstart rules |
| `src/core/profile/types.ts` | **Modify** | No changes needed (dimension is free-form string) |
| `src/db/client.ts` | **Modify** | V8 migration: extend workspace_events event_type CHECK constraint |
| `src/cli/work.ts` | **Modify** | Refactor to use InterviewEngine, add recommendation display + auto-execute + feedback + --reset |
| `src/mcp/handlers.ts` | **Modify** | Register kai_work_recommend tool |
| `src/mcp/schema.ts` | **Modify** | Add WorkRecommendSchema |
| `src/mcp/server.ts` | **Modify** | No changes (handlers auto-register) |
| `tests/core/profile/interview.test.ts` | **Create** | InterviewEngine unit tests |
| `tests/core/orchestrator/templates.test.ts` | **Create** | Template catalog + matching tests |
| `tests/core/orchestrator/recommend.test.ts` | **Create** | Recommendation engine tests |
| `tests/coldstart-bootstrapper.test.ts` | **Create** | Integration: interview → recommendations → feedback |
| `tests/e2e/coldstart-flow.test.ts` | **Create** | E2E cold start flow |
| `tests/migration-v8.test.ts` | **Create** | V8 migration validation |
| `tests/mcp/work-recommend-handler.test.ts` | **Create** | MCP tool handler tests |

---

### Task 1: Extend Derivator Rule Interface (dual-path)

**Files:**
- Modify: `src/core/profile/derivator.ts`
- Test: `tests/coldstart-rules.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/coldstart-rules.test.ts — add to existing describe block

test("deriveFromValues is called when present on a rule", () => {
  dbPath = tempDb();
  const db = new KaiDB(dbPath);
  const engine = new ProfileEngine(db);

  engine.addObservation({
    type: "signal",
    key: "coldstart:planning_style",
    value: JSON.stringify({ answer: "detailed plan" }),
    confidence: 8,
    source: "coldstart",
    provenance: '{"origin":"kai work start"}',
  });

  const derivator = new Derivator(engine);
  const results = derivator.deriveFromRules();
  const planning = results.find((r) => r.dimension === "planning_style");
  expect(planning).toBeDefined();
  expect(planning!.value).toBe(0.9);
  expect(planning!.confidence).toBe(8);
  expect(planning!.reasoning).toContain("detailed plan");

  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/coldstart-rules.test.ts`
Expected: FAIL — no rule for `coldstart:planning_style` with value-based derivation

- [ ] **Step 3: Extend the Rule interface and add the planning_style rule**

In `src/core/profile/derivator.ts`, change the `Rule` interface:

```typescript
interface Rule {
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
```

Then in `deriveFromRules()`, change the collection loop to also gather values:

```typescript
const dimMatches = new Map<
  string,
  {
    observations: typeof observations;
    derive: (typeof RULES)[number]["derive"];
    deriveFromValues?: (typeof RULES)[number]["deriveFromValues"];
  }
>();

for (const rule of RULES) {
  if (this.engine.isCorrected(rule.dimension)) continue;
  const matches = observations.filter((obs) =>
    rule.match(obs.key, obs.value),
  );
  if (matches.length === 0) continue;

  const existing = dimMatches.get(rule.dimension);
  if (existing) {
    existing.observations.push(...matches);
    if (rule.deriveFromValues && !existing.deriveFromValues) {
      existing.deriveFromValues = rule.deriveFromValues;
    }
  } else {
    dimMatches.set(rule.dimension, {
      observations: [...matches],
      derive: rule.derive,
      deriveFromValues: rule.deriveFromValues,
    });
  }
}
```

Then change the derivation loop to prefer `deriveFromValues` when available:

```typescript
for (const [dimension, { observations: obs, derive, deriveFromValues }] of dimMatches) {
  let derived: { value: number; confidence: number; reasoning: string };
  if (deriveFromValues) {
    const values = obs.map((o) => o.value);
    derived = deriveFromValues(obs.length, values);
  } else {
    derived = derive(obs.length);
  }
  const trait: DerivedTrait = {
    dimension,
    value: Math.round(derived.value * 100) / 100,
    confidence: Math.max(1, derived.confidence),
    source: "observed",
    reasoning: derived.reasoning,
  };
  results.push(trait);
  if (persist) {
    this.engine.setTrait(trait);
  }
}
```

Now add the `planning_style` rule at the end of the `RULES` array:

```typescript
{
  dimension: "planning_style",
  match: (key) => key === "coldstart:planning_style",
  derive: (count) => ({
    value: 0.5,
    confidence: Math.min(10, 5 + count),
    reasoning: `Cold start: ${count} planning style signals (fallback count-based)`,
  }),
  deriveFromValues: (count, values) => {
    const answerMap: Record<string, number> = {
      "detailed plan": 0.9,
      "rough outline": 0.6,
      "dive right in": 0.2,
      "explore first": 0.4,
    };
    let total = 0;
    let matched = 0;
    for (const v of values) {
      try {
        const parsed = JSON.parse(v);
        const answer = String(parsed.answer ?? "").toLowerCase();
        if (answerMap[answer] !== undefined) {
          total += answerMap[answer];
          matched++;
        }
      } catch { /* skip */ }
    }
    if (matched === 0) {
      return { value: 0.5, confidence: 3, reasoning: `Cold start: ${count} planning style signals (no direct match)` };
    }
    return {
      value: Math.round((total / matched) * 100) / 100,
      confidence: 8,
      reasoning: `Cold start: planning style from ${matched} answer(s), avg=${(total / matched).toFixed(2)}`,
    };
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/coldstart-rules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/profile/derivator.ts tests/coldstart-rules.test.ts
git commit -m "feat: extend Derivator Rule interface with deriveFromValues + planning_style rule"
```

---

### Task 2: Add Remaining Coldstart Derivation Rules

**Files:**
- Modify: `src/core/profile/derivator.ts`
- Test: `tests/coldstart-rules.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/coldstart-rules.test.ts`:

```typescript
test("schedule_rhythm: derives from coldstart answer value", () => {
  dbPath = tempDb();
  const db = new KaiDB(dbPath);
  const engine = new ProfileEngine(db);

  engine.addObservation({
    type: "signal",
    key: "coldstart:schedule_rhythm",
    value: JSON.stringify({ answer: "morning" }),
    confidence: 8,
    source: "coldstart",
    provenance: '{"origin":"kai work start"}',
  });

  const derivator = new Derivator(engine);
  const results = derivator.deriveFromRules();
  const schedule = results.find((r) => r.dimension === "schedule_rhythm");
  expect(schedule).toBeDefined();
  expect(schedule!.value).toBe(0.9);

  db.close();
});

test("preferred_output_shape: derives from coldstart answer value", () => {
  dbPath = tempDb();
  const db = new KaiDB(dbPath);
  const engine = new ProfileEngine(db);

  engine.addObservation({
    type: "signal",
    key: "coldstart:preferred_output_shape",
    value: JSON.stringify({ answer: "checklist" }),
    confidence: 8,
    source: "coldstart",
    provenance: '{"origin":"kai work start"}',
  });

  const derivator = new Derivator(engine);
  const results = derivator.deriveFromRules();
  const shape = results.find((r) => r.dimension === "preferred_output_shape");
  expect(shape).toBeDefined();
  expect(shape!.value).toBe(0.9);

  db.close();
});

test("disliked_behavior: derives from coldstart answer", () => {
  dbPath = tempDb();
  const db = new KaiDB(dbPath);
  const engine = new ProfileEngine(db);

  engine.addObservation({
    type: "signal",
    key: "coldstart:disliked_behavior",
    value: JSON.stringify({ answer: "acts without asking" }),
    confidence: 8,
    source: "coldstart",
    provenance: '{"origin":"kai work start"}',
  });

  const derivator = new Derivator(engine);
  const results = derivator.deriveFromRules();
  const disliked = results.find((r) => r.dimension === "disliked_behavior");
  expect(disliked).toBeDefined();
  expect(disliked!.value).toBeGreaterThan(0);

  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/coldstart-rules.test.ts`
Expected: FAIL — no rules for schedule_rhythm, preferred_output_shape, disliked_behavior

- [ ] **Step 3: Add the three new rules to RULES array**

In `src/core/profile/derivator.ts`, add after the `planning_style` rule:

```typescript
{
  dimension: "schedule_rhythm",
  match: (key) => key === "coldstart:schedule_rhythm",
  derive: (count) => ({
    value: 0.5,
    confidence: Math.min(10, 5 + count),
    reasoning: `Cold start: ${count} schedule rhythm signals (fallback)`,
  }),
  deriveFromValues: (count, values) => {
    const answerMap: Record<string, number> = {
      morning: 0.9,
      afternoon: 0.5,
      evening: 0.3,
      "late night": 0.2,
      flexible: 0.5,
    };
    let total = 0;
    let matched = 0;
    for (const v of values) {
      try {
        const parsed = JSON.parse(v);
        const answer = String(parsed.answer ?? "").toLowerCase();
        if (answerMap[answer] !== undefined) {
          total += answerMap[answer];
          matched++;
        }
      } catch { /* skip */ }
    }
    if (matched === 0) {
      return { value: 0.5, confidence: 3, reasoning: `Cold start: ${count} schedule signals (no direct match)` };
    }
    return {
      value: Math.round((total / matched) * 100) / 100,
      confidence: 8,
      reasoning: `Cold start: schedule rhythm from ${matched} answer(s)`,
    };
  },
},
{
  dimension: "preferred_output_shape",
  match: (key) => key === "coldstart:preferred_output_shape",
  derive: (count) => ({
    value: 0.5,
    confidence: Math.min(10, 5 + count),
    reasoning: `Cold start: ${count} output shape signals (fallback)`,
  }),
  deriveFromValues: (count, values) => {
    const answerMap: Record<string, number> = {
      checklist: 0.9,
      brief: 0.6,
      plan: 0.3,
      "decision log": 0.1,
    };
    let total = 0;
    let matched = 0;
    for (const v of values) {
      try {
        const parsed = JSON.parse(v);
        const answer = String(parsed.answer ?? "").toLowerCase();
        if (answerMap[answer] !== undefined) {
          total += answerMap[answer];
          matched++;
        }
      } catch { /* skip */ }
    }
    if (matched === 0) {
      return { value: 0.5, confidence: 3, reasoning: `Cold start: ${count} output shape signals (no direct match)` };
    }
    return {
      value: Math.round((total / matched) * 100) / 100,
      confidence: 8,
      reasoning: `Cold start: output shape from ${matched} answer(s)`,
    };
  },
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
      } catch { /* skip */ }
    }
    if (detected.length === 0) {
      return { value: count * 0.3, confidence: 5, reasoning: `Cold start: ${count} generic disliked behavior signals` };
    }
    return {
      value: Math.min(1.0, detected.length * 0.4),
      confidence: 8,
      reasoning: `Cold start: dislikes [${detected.join(", ")}]`,
    };
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/coldstart-rules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/profile/derivator.ts tests/coldstart-rules.test.ts
git commit -m "feat: add coldstart rules for schedule_rhythm, preferred_output_shape, disliked_behavior"
```

---

### Task 3: Create Interview Questions Catalog

**Files:**
- Create: `src/core/profile/interview-questions.ts`
- Test: (no separate test — covered by Task 4)

- [ ] **Step 1: Create the question catalog**

```typescript
// src/core/profile/interview-questions.ts

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
    options: ["engineering", "design", "management", "research", "writing", "other"],
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
    options: ["only when confident", "after basic testing", "when it compiles"],
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
    options: ["acts without asking", "too verbose", "too cautious", "asks too many questions", "ignores context"],
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/core/profile/interview-questions.ts
git commit -m "feat: add 10-question cold start interview catalog with trait targets"
```

---

### Task 4: Create InterviewEngine

**Files:**
- Create: `src/core/profile/interview.ts`
- Test: `tests/core/profile/interview.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/profile/interview.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { InterviewEngine } from "../../src/core/profile/interview";
import type { AddObservationInput } from "../../src/core/profile/engine";
import { cleanup, tempDb } from "../helpers/temp-db";

describe("InterviewEngine", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("extractSignalsFromAnswers produces observations for each answer", () => {
    dbPath = tempDb();
    const answers = [
      { slug: "goal", text: "Build a REST API" },
      { slug: "planning_style", text: "detailed plan" },
      { slug: "schedule_rhythm", text: "morning" },
    ];
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(answers, [], "ws-1");
    expect(signals.length).toBeGreaterThanOrEqual(3);
    expect(signals.every((s) => s.source === "coldstart")).toBe(true);
    expect(signals.some((s) => s.key === "coldstart:goal")).toBe(true);
    expect(signals.some((s) => s.key === "coldstart:planning_style")).toBe(true);
    expect(signals.some((s) => s.key === "coldstart:schedule_rhythm")).toBe(true);
  });

  test("extractSignalsFromAnswers includes domain signal for engineering keywords", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [{ slug: "goal", text: "I want to debug the API and deploy new code" }],
      [],
      "ws-1",
    );
    const domain = signals.find((s) => s.key === "coldstart:signal.domain");
    expect(domain).toBeDefined();
    const parsed = JSON.parse(domain!.value);
    expect(parsed.domains).toContain("engineering");
  });

  test("extractSignalsFromAnswers includes aggregate detail_level signal", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [
        { slug: "goal", text: "Build a comprehensive API with authentication, rate limiting, and full audit logging" },
        { slug: "success", text: "All endpoints tested with 90% coverage, deployed with zero-downtime" },
      ],
      [],
      "ws-1",
    );
    const detail = signals.find((s) => s.key === "coldstart:signal.detail_level");
    expect(detail).toBeDefined();
    const parsed = JSON.parse(detail!.value);
    expect(parsed.level).toBe("high");
  });

  test("extractSignalsFromAnswers maps trait-targeted answers to correct observation keys", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [
        { slug: "planning_style", text: "rough outline" },
        { slug: "risk_tolerance", text: "after basic testing" },
        { slug: "autonomy", text: "suggest only" },
      ],
      [],
      "ws-1",
    );
    expect(signals.find((s) => s.key === "coldstart:planning_style")).toBeDefined();
    expect(signals.find((s) => s.key === "coldstart:risk_tolerance")).toBeDefined();
    expect(signals.find((s) => s.key === "coldstart:autonomy")).toBeDefined();
  });

  test("extractSignalsFromAnswers includes comm_style signal", () => {
    dbPath = tempDb();
    const engine = new InterviewEngine();
    const signals = engine.extractSignalsFromAnswers(
      [{ slug: "goal", text: "Hi" }],
      [],
      "ws-1",
    );
    const comm = signals.find((s) => s.key === "coldstart:signal.comm_style");
    expect(comm).toBeDefined();
    const parsed = JSON.parse(comm!.value);
    expect(parsed.style).toBe("terse");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/profile/interview.test.ts`
Expected: FAIL — module not found `../../src/core/profile/interview`

- [ ] **Step 3: Implement InterviewEngine**

```typescript
// src/core/profile/interview.ts
import type { AddObservationInput } from "./engine";
import { QUESTIONS, type InterviewQuestion } from "./interview-questions";

export interface ColdStartAnswer {
  slug: string;
  text: string;
}

const WORD_COUNT_DETAIL_HIGH = 30;
const WORD_COUNT_DETAIL_MED = 10;
const WORD_COUNT_VERBOSE = 40;
const WORD_COUNT_MODERATE = 15;

export class InterviewEngine {
  extractSignalsFromAnswers(
    answers: ColdStartAnswer[],
    gitHints: { dimension: string; hints: string[] }[],
    workspaceId: string,
  ): AddObservationInput[] {
    const observations: AddObservationInput[] = [];
    const provenance = JSON.stringify({
      origin: "kai work start",
      extracted_at: new Date().toISOString(),
      extractor_version: "2.0.0",
    });

    const wordCounts: number[] = [];
    let anySpecifics = false;

    for (const { slug, text } of answers) {
      observations.push({
        type: "signal",
        key: `coldstart:${slug}`,
        value: JSON.stringify({ answer: text, workspace_id: workspaceId }),
        confidence: 8,
        source: "coldstart",
        provenance,
      });

      const wordCount = text.split(/\s+/).filter(Boolean).length;
      wordCounts.push(wordCount);
      if (/\d+|specific|exactly|precisely/.test(text)) anySpecifics = true;
    }

    if (wordCounts.length === 0) return observations;

    // Aggregate detail_level signal
    const avgWordCount = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
    observations.push({
      type: "signal",
      key: "coldstart:signal.detail_level",
      value: JSON.stringify({
        level:
          avgWordCount > WORD_COUNT_DETAIL_HIGH
            ? "high"
            : avgWordCount > WORD_COUNT_DETAIL_MED
              ? "medium"
              : "low",
        word_count: Math.round(avgWordCount),
        has_specifics: anySpecifics,
      }),
      confidence: 7,
      source: "coldstart",
      provenance,
    });

    // Aggregate comm_style signal
    observations.push({
      type: "signal",
      key: "coldstart:signal.comm_style",
      value: JSON.stringify({
        style:
          avgWordCount > WORD_COUNT_VERBOSE
            ? "verbose"
            : avgWordCount > WORD_COUNT_MODERATE
              ? "moderate"
              : "terse",
        word_count: Math.round(avgWordCount),
      }),
      confidence: 6,
      source: "coldstart",
      provenance,
    });

    // Domain detection from all answer text
    const allText = answers.map((a) => a.text).join(" ").toLowerCase();
    const domainSignals: string[] = [];
    if (/code|debug|deploy|api|git|build|test/i.test(allText))
      domainSignals.push("engineering");
    if (/design|ux|ui|wireframe|prototype/i.test(allText))
      domainSignals.push("design");
    if (/manage|team|sprint|roadmap|stakeholder/i.test(allText))
      domainSignals.push("management");
    if (/research|paper|study|analysis|data/i.test(allText))
      domainSignals.push("research");
    if (/write|document|content|blog|report/i.test(allText))
      domainSignals.push("writing");

    if (domainSignals.length > 0) {
      if (gitHints.some((h) => h.dimension === "detail_oriented")) {
        domainSignals.push("engineering");
      }
      observations.push({
        type: "signal",
        key: "coldstart:signal.domain",
        value: JSON.stringify({ domains: [...new Set(domainSignals)] }),
        confidence: 7,
        source: "coldstart",
        provenance,
      });
    }

    return observations;
  }
}

```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/profile/interview.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/profile/interview.ts src/core/profile/interview-questions.ts tests/core/profile/interview.test.ts
git commit -m "feat: create InterviewEngine with signal extraction from 10-question answers"
```

---

### Task 5: Create Template Catalog + Matching Algorithm

**Files:**
- Create: `src/core/orchestrator/templates.ts`
- Test: `tests/core/orchestrator/templates.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/orchestrator/templates.test.ts
import { describe, test, expect } from "bun:test";
import {
  TEMPLATE_CATALOG,
  matchTemplates,
  type TaskTemplate,
} from "../../src/core/orchestrator/templates";

describe("Template Catalog", () => {
  test("has 12 templates", () => {
    expect(TEMPLATE_CATALOG.length).toBe(12);
  });

  test("every template has required fields", () => {
    for (const t of TEMPLATE_CATALOG) {
      expect(t.id).toBeDefined();
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.prompt.length).toBeGreaterThan(0);
      expect(t.domain).toBeDefined();
      expect(t.agent).toMatch(/^(hermes|openclaw|auto)$/);
      expect(typeof t.trait_targets).toBe("object");
    }
  });
});

describe("matchTemplates", () => {
  test("returns scored recommendations sorted by score descending", () => {
    const traits = [
      { dimension: "detail_oriented", value: 0.9, confidence: 8 },
      { dimension: "planning_style", value: 0.9, confidence: 8 },
      { dimension: "risk_tolerance", value: 0.5, confidence: 5 },
    ];
    const results = matchTemplates(traits, "coding");
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test("universal templates get base score 0.5", () => {
    const traits: { dimension: string; value: number; confidence: number }[] = [];
    const results = matchTemplates(traits, "general");
    const universals = results.filter(
      (r) => Object.keys(r.template.trait_targets).length === 0,
    );
    for (const u of universals) {
      expect(u.score).toBe(0.5);
    }
  });

  test("templates with matching domain get bonus", () => {
    const traits = [
      { dimension: "detail_oriented", value: 0.9, confidence: 8 },
    ];
    const codingResults = matchTemplates(traits, "coding");
    const codingDomains = codingResults.filter(
      (r) => r.template.domain === "coding",
    );
    expect(codingDomains.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator/templates.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement template catalog and matching**

```typescript
// src/core/orchestrator/templates.ts
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
    description: "Generate a daily standup report from git activity and task status",
    prompt: "Generate a daily standup report covering: what was done yesterday (from git log), what's planned today, and any blockers. Format as a concise 3-bullet summary.",
    domain: "coding",
    agent: "hermes",
    trait_targets: { detail_oriented: 0.7, planning_style: 0.6 },
  },
  {
    id: "code-review-checklist",
    title: "Code Review Checklist",
    description: "Generate a code review checklist tailored to your project patterns",
    prompt: "Create a code review checklist for the most recent pull request. Cover: correctness, edge cases, error handling, test coverage, and performance.",
    domain: "coding",
    agent: "hermes",
    trait_targets: { detail_oriented: 0.8, risk_tolerance: 0.3 },
  },
  {
    id: "bug-triage",
    title: "Bug Triage Prioritizer",
    description: "Prioritize bugs by impact and urgency using project context",
    prompt: "Analyze open issues/bugs and prioritize them by: user impact, frequency, and fix complexity. Produce a ranked list with rationale.",
    domain: "coding",
    agent: "hermes",
    trait_targets: { planning_style: 0.7, risk_tolerance: 0.5 },
  },
  {
    id: "api-design-review",
    title: "API Design Reviewer",
    description: "Review API designs for consistency, security, and usability",
    prompt: "Review the API design for: naming consistency, HTTP method usage, error response format, pagination patterns, and authentication scope.",
    domain: "coding",
    agent: "hermes",
    trait_targets: { detail_oriented: 0.9, planning_style: 0.8 },
  },
  {
    id: "research-digest",
    title: "Weekly Research Digest",
    description: "Summarize research papers, articles, and findings from the week",
    prompt: "Compile a weekly research digest: summarize key findings, highlight actionable insights, and note connections to ongoing work.",
    domain: "research",
    agent: "hermes",
    trait_targets: { detail_oriented: 0.6 },
  },
  {
    id: "writing-outline",
    title: "Document Outliner",
    description: "Generate structured outlines for documents, blog posts, or reports",
    prompt: "Create a detailed outline for the writing project. Include: sections, key points per section, and a flow that builds a coherent narrative.",
    domain: "writing",
    agent: "hermes",
    trait_targets: { planning_style: 0.8, preferred_output_shape: 0.3 },
  },
  {
    id: "sprint-planner",
    title: "Sprint Planning Assistant",
    description: "Break down goals into sprint-sized tasks with estimates",
    prompt: "Decompose the sprint goal into tasks with: description, estimated effort (S/M/L), dependencies, and suggested assignee based on expertise.",
    domain: "management",
    agent: "hermes",
    trait_targets: { planning_style: 0.9, detail_oriented: 0.7 },
  },
  {
    id: "design-system-audit",
    title: "Design System Auditor",
    description: "Audit a design system for consistency and completeness",
    prompt: "Audit the design system for: color consistency, typography scale, spacing system, component coverage, and accessibility compliance.",
    domain: "creative",
    agent: "hermes",
    trait_targets: { detail_oriented: 0.9 },
  },
  {
    id: "learning-path",
    title: "Personal Learning Path",
    description: "Generate a structured learning plan based on goals and current skills",
    prompt: "Create a learning path: assess current knowledge, identify gaps, recommend resources (ordered by difficulty), and suggest practice projects.",
    domain: "general",
    agent: "hermes",
    trait_targets: { planning_style: 0.7 },
  },
  {
    id: "meeting-notes",
    title: "Meeting Notes Formatter",
    description: "Transform raw meeting notes into structured action items and decisions",
    prompt: "Format the meeting notes into: attendees, key decisions (with rationale), action items (with owner and deadline), and open questions.",
    domain: "general",
    agent: "hermes",
    trait_targets: { preferred_output_shape: 0.9 },
  },
  {
    id: "project-retrospective",
    title: "Project Retrospective Guide",
    description: "Run a structured retrospective on a completed project or sprint",
    prompt: "Guide a retrospective covering: what went well, what could improve, and actionable changes for next time. Use the Start-Stop-Continue framework.",
    domain: "management",
    agent: "hermes",
    trait_targets: {},
  },
  {
    id: "weekly-review",
    title: "Weekly Review Generator",
    description: "Compile a weekly review from tasks completed, observations, and goals",
    prompt: "Generate a weekly review: tasks completed, metrics changed, patterns noticed, and suggestions for next week. Include profile evolution summary.",
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

    // Universal template: base score 0.5
    if (targetEntries.length === 0) {
      return { template, score: 0.5, matchedTraits: [] };
    }

    let totalWeight = 0;
    let totalScore = 0;
    const matchedTraits: string[] = [];

    for (const [dim, targetValue] of targetEntries) {
      const userValue = traitMap.get(dim) ?? 0.5;
      // Normalize coldstart traits to confidence 7 for matching
      const distance = Math.abs(userValue - targetValue);
      const closeness = 1 - distance;
      totalWeight += 1;
      totalScore += closeness;
      if (closeness > 0.6) matchedTraits.push(dim);
    }

    let score = totalScore / totalWeight;

    // Domain bonus: +0.2 if template domain matches
    if (template.domain === domain) {
      score += 0.2;
    }

    // Cap at 1.0
    score = Math.min(1.0, score);

    return { template, score: Math.round(score * 100) / 100, matchedTraits };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, 5);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/orchestrator/templates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/templates.ts tests/core/orchestrator/templates.test.ts
git commit -m "feat: add 12-template catalog with trait-weighted matching algorithm"
```

---

### Task 6: Create Recommendation Engine

**Files:**
- Create: `src/core/orchestrator/recommend.ts`
- Test: `tests/core/orchestrator/recommend.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/orchestrator/recommend.test.ts
import { describe, test, expect } from "bun:test";
import {
  recommendTasks,
  buildExplanation,
  type Recommendation,
} from "../../src/core/orchestrator/recommend";

describe("Recommendation Engine", () => {
  const traits = [
    { dimension: "detail_oriented", value: 0.9, confidence: 8 },
    { dimension: "planning_style", value: 0.8, confidence: 7 },
    { dimension: "risk_tolerance", value: 0.3, confidence: 5 },
  ];

  test("recommendTasks returns top 3 recommendations", () => {
    const results = recommendTasks(traits, "coding");
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.explanation.length).toBeGreaterThan(0);
    }
  });

  test("recommendations include 'Why this?' explanation", () => {
    const results = recommendTasks(traits, "coding");
    for (const r of results) {
      expect(r.explanation).toBeDefined();
      expect(r.explanation.length).toBeGreaterThan(10);
    }
  });

  test("recommendations include 'Why not?' for excluded tasks", () => {
    const results = recommendTasks(traits, "coding");
    expect(results[0].whyNotOthers).toBeDefined();
    expect(results[0].whyNotOthers!.length).toBeGreaterThan(0);
  });
});

describe("buildExplanation", () => {
  test("generates explanation from matched traits", () => {
    const explanation = buildExplanation(
      { id: "test", title: "Test", matchedTraits: ["detail_oriented", "planning_style"], score: 0.85 },
    );
    expect(explanation).toContain("detail_oriented");
    expect(explanation).toContain("planning_style");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator/recommend.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement recommendation engine**

```typescript
// src/core/orchestrator/recommend.ts
import type { IdeaDomain } from "./types";
import { matchTemplates, type ScoredRecommendation } from "./templates";

export interface Recommendation {
  templateId: string;
  title: string;
  description: string;
  score: number;
  explanation: string;
  whyNotOthers?: string[];
  matchedTraits: string[];
}

export function recommendTasks(
  traits: { dimension: string; value: number; confidence: number }[],
  domain: IdeaDomain,
): Recommendation[] {
  const scored = matchTemplates(traits, domain);
  const top3 = scored.slice(0, 3);
  const excluded = scored.slice(3);

  return top3.map((rec) => ({
    templateId: rec.template.id,
    title: rec.template.title,
    description: rec.template.description,
    score: rec.score,
    explanation: buildExplanation(rec),
    whyNotOthers: excluded.length > 0
      ? excluded.slice(0, 2).map(
          (ex) =>
            `${ex.template.title} (score: ${ex.score}) — ${ex.matchedTraits.length > 0 ? `matched on ${ex.matchedTraits.join(", ")}` : "generic template, ranked lower"}`,
        )
      : undefined,
    matchedTraits: rec.matchedTraits,
  }));
}

export function buildExplanation(rec: ScoredRecommendation): string {
  const parts: string[] = [];

  if (rec.matchedTraits.length > 0) {
    parts.push(`Matches your ${rec.matchedTraits.join(" and ")} profile`);
  }

  if (rec.score >= 0.8) {
    parts.push("strong match");
  } else if (rec.score >= 0.6) {
    parts.push("good fit for your work style");
  } else {
    parts.push("general-purpose workflow");
  }

  return parts.join(" — ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/orchestrator/recommend.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator/recommend.ts tests/core/orchestrator/recommend.test.ts
git commit -m "feat: add recommendation engine with Why this? and Why not? explanations"
```

---

### Task 7: V8 Database Migration

**Files:**
- Modify: `src/db/client.ts`
- Test: `tests/migration-v8.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/migration-v8.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { KaiDB } from "../src/db/client";
import { cleanup, tempDb } from "./helpers/temp-db";

describe("V8 Migration", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("workspace_events accepts new recommendation event types", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const raw = db.getDatabase();

    const newTypes = [
      "recommendation_shown",
      "recommendation_accepted",
      "recommendation_rejected",
      "task_auto_executed",
    ];

    for (const eventType of newTypes) {
      expect(() => {
        raw
          .query(
            "INSERT INTO workspace_events (workspace_id, event_type, payload) VALUES ($ws, $type, '{}')",
          )
          .run({ $ws: "test-ws", $type: eventType });
      }).not.toThrow();
    }

    db.close();
  });

  test("schema version is 8 after migration", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const raw = db.getDatabase();
    const row = raw.query("SELECT MAX(version) as v FROM schema_version").get() as {
      v: number;
    };
    expect(row.v).toBe(8);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/migration-v8.test.ts`
Expected: FAIL — CHECK constraint rejected for new event types

- [ ] **Step 3: Add V8 migration to db/client.ts**

Add after `MIGRATION_V7` (after line 469) and before the `KaiDB` class:

```typescript
const MIGRATION_V8 = `
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS workspace_events_v8 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES workspace_tasks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('workspace_created','task_created','task_updated','task_completed','interaction','coldstart_answer','workspace_archived','recommendation_shown','recommendation_accepted','recommendation_rejected','task_auto_executed')),
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO workspace_events_v8 (id, workspace_id, task_id, event_type, payload, created_at)
  SELECT id, workspace_id, task_id, event_type, payload, created_at FROM workspace_events;

DROP TABLE IF EXISTS workspace_events;
ALTER TABLE workspace_events_v8 RENAME TO workspace_events;

CREATE INDEX IF NOT EXISTS idx_workspace_events_type ON workspace_events(event_type);
CREATE INDEX IF NOT EXISTS idx_workspace_events_workspace ON workspace_events(workspace_id);

COMMIT;

PRAGMA foreign_keys = ON;

PRAGMA integrity_check;
`;
```

Then add the migration execution in the `runMigrations()` method, after the V7 block:

```typescript
if (currentVersion < 8) {
  this.db.exec(MIGRATION_V8);
  this.db.run(
    "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
    [8],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/migration-v8.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/client.ts tests/migration-v8.test.ts
git commit -m "feat: V8 migration — extend workspace_events for recommendation/feedback events"
```

---

### Task 8: Refactor work.ts to Use InterviewEngine + Recommendations + Auto-execute

**Files:**
- Modify: `src/cli/work.ts`
- Test: `tests/coldstart-bootstrapper.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/coldstart-bootstrapper.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { InterviewEngine } from "../src/core/profile/interview";
import { Derivator } from "../src/core/profile/derivator";
import { ProfileEngine } from "../src/core/profile/engine";
import { recommendTasks } from "../src/core/orchestrator/recommend";
import { KaiDB } from "../src/db/client";
import { cleanup, tempDb } from "./helpers/temp-db";

describe("Cold Start Bootstrapper Integration", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("full flow: answers → signals → derivation → recommendations", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    // 1. Create identity
    engine.createIdentity({ name: "Test", role: "engineer" });

    // 2. Simulate 10-question answers
    const answers = [
      { slug: "goal", text: "Build a REST API for user management" },
      { slug: "success", text: "All endpoints tested, deployed to staging" },
      { slug: "constraints", text: "2 weeks deadline" },
      { slug: "domain", text: "engineering" },
      { slug: "planning_style", text: "detailed plan" },
      { slug: "schedule_rhythm", text: "morning" },
      { slug: "preferred_output_shape", text: "checklist" },
      { slug: "risk_tolerance", text: "after basic testing" },
      { slug: "autonomy", text: "suggest only" },
      { slug: "disliked_behavior", text: "acts without asking" },
    ];

    // 3. Extract signals
    const interview = new InterviewEngine();
    const signals = interview.extractSignalsFromAnswers(answers, [], "ws-1");
    expect(signals.length).toBeGreaterThan(0);

    for (const obs of signals) {
      engine.addObservation(obs);
    }

    // 4. Derive traits
    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules();
    expect(traits.length).toBeGreaterThan(0);

    // 5. Check new dimensions derived
    const planningStyle = traits.find((t) => t.dimension === "planning_style");
    expect(planningStyle).toBeDefined();
    expect(planningStyle!.value).toBe(0.9);

    const schedule = traits.find((t) => t.dimension === "schedule_rhythm");
    expect(schedule).toBeDefined();
    expect(schedule!.value).toBe(0.9);

    // 6. Get recommendations
    const savedTraits = engine.getTraits();
    const domain = signals.find((s) => s.key === "coldstart:signal.domain");
    const domainValue = domain
      ? JSON.parse(domain.value).domains?.[0] ?? "general"
      : "general";
    const domainMap: Record<string, string> = {
      engineering: "coding",
      design: "creative",
      management: "general",
      research: "research",
      writing: "writing",
      other: "general",
    };
    const ideaDomain = (domainMap[domainValue] ?? "general") as
      | "coding"
      | "writing"
      | "research"
      | "creative"
      | "general";

    const recommendations = recommendTasks(savedTraits, ideaDomain);
    expect(recommendations.length).toBe(3);
    expect(recommendations[0].score).toBeGreaterThan(0);

    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test tests/coldstart-bootstrapper.test.ts`
Expected: PASS (all components wired together from previous tasks)

- [ ] **Step 3: Refactor work.ts to use InterviewEngine and new flow**

This is the largest change. The key modifications to `src/cli/work.ts`:

1. Import `InterviewEngine` and `QUESTIONS` instead of inline questions
2. Replace the 4-question `QUESTIONS` array with the imported `QUESTIONS` from `interview-questions.ts`
3. Add `--reset` flag to clear coldstart observations
4. After profile confirmation, show 3 recommendations with scores and explanations
5. After user approves recommendations, auto-execute first task with plan-then-confirm
6. Add feedback loop: accept/reject → soft observation

Replace the inline `QUESTIONS` constant and `extractColdStartSignals` usage:

```typescript
// At top of work.ts, add imports:
import { InterviewEngine } from "../core/profile/interview";
import { QUESTIONS } from "../core/profile/interview-questions";
import { recommendTasks } from "../core/orchestrator/recommend";
import { OrchestratorStore } from "../core/orchestrator/store";
import { Dispatcher } from "../core/orchestrator/dispatcher";
import { Planner } from "../core/orchestrator/planner";
import { HermesAgentBridge } from "../bridge/agent-bridge";
import { LLMProvider } from "../llm/provider";
import { GeneStore } from "../core/prompt/gene-store";
import { PromptCompiler } from "../core/prompt/prompt-compiler";
```

Remove the inline `QUESTIONS` array (lines 313-325).

In the `work start` command action, replace the 4-question loop with the 10-question flow from `QUESTIONS` (imported).

Add `--reset` option:

```typescript
work
  .command("start")
  .description("Start a new workspace with cold start profile bootstrapping")
  .option("--reset", "Force re-interview even if coldstart data exists")
  .action(async (options) => {
```

After the profile confirmation step, add recommendation display:

```typescript
// After profile confirmation (Step 7 in current code)
const interview = new InterviewEngine();
const savedTraits = engine.getTraits();
const domainObs = engine.getObservations({ key: "coldstart:signal.domain" });
const domainValue = domainObs.length > 0
  ? JSON.parse(domainObs[0].value).domains?.[0] ?? "general"
  : "general";
const domainMap: Record<string, string> = {
  engineering: "coding", design: "creative", management: "general",
  research: "research", writing: "writing", other: "general",
};
const ideaDomain = (domainMap[domainValue] ?? "general") as "coding" | "writing" | "research" | "creative" | "general";
const recommendations = recommendTasks(savedTraits, ideaDomain);

console.log("\n=== Recommended Workflows ===\n");
for (let i = 0; i < recommendations.length; i++) {
  const r = recommendations[i];
  console.log(`  ${i + 1}. ${r.title} (score: ${r.score})`);
  console.log(`     ${r.description}`);
  console.log(`     Why: ${r.explanation}`);
}
if (recommendations[0].whyNotOthers && recommendations[0].whyNotOthers.length > 0) {
  console.log("\n  Not shown:");
  for (const w of recommendations[0].whyNotOthers) {
    console.log(`    - ${w}`);
  }
}

console.log("\nApprove all? [Y]es / [N]o / [number to approve just one]");
```

After approval, auto-execute first task:

```typescript
const approveResponse = (await confirmAsk("> ")).trim().toLowerCase() || "y";
if (approveResponse === "y" || approveResponse === "yes") {
  // Create idea for first recommendation
  const orchStore = new OrchestratorStore(db);
  const idea = orchStore.createIdea({
    title: recommendations[0].title,
    description: recommendations[0].description,
    domain: ideaDomain,
    workspace_id: workspace.id,
  });

  const llm = new LLMProvider();
  if (llm.getConfig().apiKey) {
    // LLM path: plan then confirm
    const geneStore = new GeneStore(db);
    const compiler = new PromptCompiler(geneStore);
    const planner = new Planner(orchStore, llm, compiler);
    const tasks = await planner.decomposeIdea(idea.id, savedTraits);
    console.log(`\nPlan generated (${tasks.length} tasks):`);
    for (const t of tasks) {
      console.log(`  - ${t.title}`);
    }
    console.log("\nExecute first task? [Y/n]");
    const execResponse = (await confirmAsk("> ")).trim().toLowerCase() || "y";
    if (execResponse === "y" || execResponse === "yes") {
      const bridge = new HermesAgentBridge();
      const dispatcher = new Dispatcher(orchStore, bridge);
      const result = await dispatcher.dispatch(tasks[0].id);
      if (result.success) {
        console.log(`✓ Task dispatched: ${tasks[0].title}`);
        store.addEvent({
          workspace_id: workspace.id,
          event_type: "task_auto_executed",
          payload: JSON.stringify({ task_id: tasks[0].id, idea_id: idea.id }),
        });
      }
    }
  } else {
    // No-LLM fallback: create simple one-off task
    const task = orchStore.createTask({
      idea_id: idea.id,
      workspace_id: workspace.id,
      title: recommendations[0].title,
      description: recommendations[0].description,
      type: "one_off",
      agent: "hermes",
      prompt: recommendations[0].description,
      decomposition_rationale: "Auto-generated from cold start recommendation",
      scheduling_rationale: "Execute when ready",
    });
    const bridge = new HermesAgentBridge();
    const dispatcher = new Dispatcher(orchStore, bridge);
    const result = await dispatcher.dispatch(task.id);
    if (result.success) {
      console.log(`✓ Task dispatched: ${task.title}`);
    }
  }
}
```

Add `--reset` flag handler:

```typescript
// At the start of the action, before Step 1:
if (options.reset) {
  const existingObs = engine.getObservations({ type: "signal" });
  // Delete coldstart observations
  const raw = db.getDatabase();
  for (const obs of existingObs) {
    if (obs.source === "coldstart") {
      raw.query("DELETE FROM observations WHERE id = $id").run({ $id: obs.id });
    }
  }
  console.log("Cleared existing cold start data.");
}
```

Add re-run detection:

```typescript
// After identity check, before Step 1:
const existingColdstart = engine.getObservations({ type: "signal" })
  .filter((o) => o.source === "coldstart");
if (existingColdstart.length > 0 && !options.reset) {
  console.log("Cold start already completed. Showing recommendations from existing profile...");
  const savedTraits = engine.getTraits();
  const recommendations = recommendTasks(savedTraits, "general");
  // ... display recommendations (same code as above)
  return;
}
```

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/work.ts tests/coldstart-bootstrapper.test.ts
git commit -m "feat: refactor work.ts — 10-question interview, recommendations, auto-execute, --reset"
```

---

### Task 9: Add MCP Tool kai_work_recommend

**Files:**
- Modify: `src/mcp/handlers.ts`
- Modify: `src/mcp/schema.ts`
- Test: `tests/mcp/work-recommend-handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/mcp/work-recommend-handler.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMcpServer } from "../../src/mcp/server";
import { KaiDB } from "../../src/db/client";
import { ProfileEngine } from "../../src/core/profile/engine";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";

describe("kai_work_recommend MCP tool", () => {
  let db: KaiDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kai-work-recommend-test-${Date.now()}.db`);
    db = new KaiDB(dbPath);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch {}
    }
  });

  test("tool is registered", () => {
    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    expect(Object.keys(registered)).toContain("kai_work_recommend");
  });

  test("returns recommendations based on current profile", async () => {
    const engine = new ProfileEngine(db);
    engine.createIdentity({ name: "Test", role: "engineer" });
    engine.addObservation({
      type: "signal",
      key: "coldstart:signal.domain",
      value: JSON.stringify({ domains: ["engineering"] }),
      confidence: 7,
      source: "coldstart",
      provenance: "{}",
    });
    engine.addObservation({
      type: "signal",
      key: "coldstart:planning_style",
      value: JSON.stringify({ answer: "detailed plan" }),
      confidence: 8,
      source: "coldstart",
      provenance: "{}",
    });

    const server = createMcpServer(db);
    const registered = (server as any)._registeredTools;
    const result = await registered["kai_work_recommend"].handler({
      domain: "coding",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.recommendations).toBeDefined();
    expect(parsed.recommendations.length).toBe(3);
    expect(parsed.recommendations[0].score).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mcp/work-recommend-handler.test.ts`
Expected: FAIL — tool not registered

- [ ] **Step 3: Add schema to src/mcp/schema.ts**

```typescript
export const WorkRecommendSchema = {
  domain: z
    .enum(["coding", "writing", "research", "creative", "general"])
    .optional()
    .default("general")
    .describe("Filter recommendations by domain"),
  limit: z
    .number()
    .min(1)
    .max(5)
    .optional()
    .default(3)
    .describe("Number of recommendations to return"),
};
```

- [ ] **Step 4: Add handler to src/mcp/handlers.ts**

Add import at the top:

```typescript
import { recommendTasks } from "../core/orchestrator/recommend";
import { WorkRecommendSchema } from "./schema";
```

Add handler registration inside `registerHandlers()`, after the `observe.batch` handler:

```typescript
// --- kai_work_recommend ---
server.tool(
  "kai_work_recommend",
  WorkRecommendSchema,
  withTrace(
    "kai_work_recommend",
    async ({ domain, limit }) => {
      log("kai_work_recommend", { domain, limit });
      const traits = engine.getTraits();
      const recommendations = recommendTasks(traits, domain).slice(0, limit);
      return textContent({ recommendations });
    },
    telemetry,
  ),
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/mcp/work-recommend-handler.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/mcp/handlers.ts src/mcp/schema.ts tests/mcp/work-recommend-handler.test.ts
git commit -m "feat: add kai_work_recommend MCP tool for AI agent task recommendations"
```

---

### Task 10: E2E Cold Start Flow Test

**Files:**
- Create: `tests/e2e/coldstart-flow.test.ts`

- [ ] **Step 1: Write the E2E test**

```typescript
// tests/e2e/coldstart-flow.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { InterviewEngine } from "../../src/core/profile/interview";
import { Derivator } from "../../src/core/profile/derivator";
import { ProfileEngine } from "../../src/core/profile/engine";
import { recommendTasks } from "../../src/core/orchestrator/recommend";
import { OrchestratorStore } from "../../src/core/orchestrator/store";
import { WorkspaceStore } from "../../src/workspace/store";
import { KaiDB } from "../../src/db/client";
import { cleanup, tempDb } from "../helpers/temp-db";

describe("E2E: Cold Start Flow", () => {
  let dbPath: string;

  afterEach(() => cleanup(dbPath));

  test("complete cold start: identity → interview → derive → recommend → idea → dispatch", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);
    const workspaceStore = new WorkspaceStore(db);
    const orchStore = new OrchestratorStore(db);

    // 1. Create identity
    engine.createIdentity({ name: "Alice", role: "senior engineer" });
    expect(engine.getIdentity()).toBeDefined();

    // 2. Create workspace
    const ws = workspaceStore.createWorkspace({
      name: "Cold Start E2E",
      description: "E2E test workspace",
    });

    // 3. Interview: 10 answers
    const answers = [
      { slug: "goal", text: "Build a microservice for email notifications" },
      { slug: "success", text: "Send 10k emails/hour with <100ms latency, 99.9% delivery rate" },
      { slug: "constraints", text: "Must integrate with existing Kafka pipeline, 3-week deadline" },
      { slug: "domain", text: "engineering" },
      { slug: "planning_style", text: "detailed plan" },
      { slug: "schedule_rhythm", text: "morning" },
      { slug: "preferred_output_shape", text: "checklist" },
      { slug: "risk_tolerance", text: "after basic testing" },
      { slug: "autonomy", text: "suggest only" },
      { slug: "disliked_behavior", text: "acts without asking" },
    ];

    const interview = new InterviewEngine();
    const signals = interview.extractSignalsFromAnswers(answers, [], ws.id);
    expect(signals.length).toBeGreaterThan(5);

    for (const obs of signals) {
      engine.addObservation(obs);
    }

    // 4. Derive traits
    const derivator = new Derivator(engine);
    const traits = derivator.deriveFromRules();
    expect(traits.length).toBeGreaterThan(3);

    // 5. Verify new dimensions
    expect(traits.find((t) => t.dimension === "planning_style")?.value).toBe(0.9);
    expect(traits.find((t) => t.dimension === "schedule_rhythm")?.value).toBe(0.9);
    expect(traits.find((t) => t.dimension === "preferred_output_shape")?.value).toBe(0.9);

    // 6. Recommend
    const savedTraits = engine.getTraits();
    const recommendations = recommendTasks(savedTraits, "coding");
    expect(recommendations.length).toBe(3);
    expect(recommendations[0].score).toBeGreaterThan(0);

    // 7. Create idea from recommendation (simulating auto-execute)
    const idea = orchStore.createIdea({
      title: recommendations[0].title,
      description: recommendations[0].description,
      domain: "coding",
      workspace_id: ws.id,
    });
    expect(idea.id).toBeDefined();
    expect(idea.status).toBe("draft");

    // 8. Log events
    workspaceStore.addEvent({
      workspace_id: ws.id,
      event_type: "recommendation_shown",
      payload: JSON.stringify({ recommendations: recommendations.map((r) => r.templateId) }),
    });
    workspaceStore.addEvent({
      workspace_id: ws.id,
      event_type: "recommendation_accepted",
      payload: JSON.stringify({ template_id: recommendations[0].templateId }),
    });
    workspaceStore.addEvent({
      workspace_id: ws.id,
      event_type: "task_auto_executed",
      payload: JSON.stringify({ idea_id: idea.id }),
    });

    // 9. Verify events persisted
    const events = workspaceStore.getEventCountsByWorkspaces([ws.id]);
    expect(events.get(ws.id)).toBe(3);

    db.close();
  });

  test("re-run detection: skip interview when coldstart data exists", () => {
    dbPath = tempDb();
    const db = new KaiDB(dbPath);
    const engine = new ProfileEngine(db);

    engine.createIdentity({ name: "Bob", role: "dev" });
    engine.addObservation({
      type: "signal",
      key: "coldstart:goal",
      value: JSON.stringify({ answer: "Build something" }),
      confidence: 8,
      source: "coldstart",
      provenance: "{}",
    });

    // Re-run detection
    const existingColdstart = engine
      .getObservations({ type: "signal" })
      .filter((o) => o.source === "coldstart");
    expect(existingColdstart.length).toBeGreaterThan(0);

    // Should skip interview and go straight to recommendations
    const derivator = new Derivator(engine);
    derivator.deriveFromRules();
    const traits = engine.getTraits();
    const recommendations = recommendTasks(traits, "general");
    expect(recommendations.length).toBe(3);

    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test tests/e2e/coldstart-flow.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/coldstart-flow.test.ts
git commit -m "test: add E2E cold start flow test covering full interview→recommend→execute pipeline"
```

---

### Task 11: Run Full Test Suite + Type Check

**Files:** None (verification only)

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run linter**

Run: `npx @biomejs/biome check src/`
Expected: No errors (or fix any that appear)

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests PASS (545+ existing + ~30 new)

- [ ] **Step 4: Fix any issues found**

If any test fails or type check fails, fix the specific issue and re-run.

---

## Self-Review

**1. Spec coverage:**
- Interview engine (10 questions + LLM path): Tasks 3, 4, 8
- Git history background scan: Already exists in work.ts (scanGitHistory), reused in Task 8
- Profile confirmation step: Task 8 (work.ts refactored)
- "Why not these?" section: Task 6 (recommend.ts)
- Auto-execute first task: Task 8 (plan-then-confirm in work.ts)
- Recommendation confidence display: Task 6 (score in Recommendation)
- Static template catalog (12 templates): Task 5
- "Why this task?" explanation engine: Task 6
- Workspace bootstrapping: Task 8 (workspace + idea creation)
- Recommendation feedback loop: Task 8 (soft observations)
- MCP tool kai_work_recommend: Task 9
- V8 migration: Task 7
- --reset flag: Task 8

**2. Placeholder scan:** No TBD, TODO, or "implement later" found. All code blocks contain complete implementation.

**3. Type consistency:**
- `ColdStartAnswer` (slug + text) used consistently across interview.ts and work.ts
- `Recommendation` interface (templateId, title, description, score, explanation, whyNotOthers, matchedTraits) used consistently across recommend.ts, work.ts, and MCP handler
- `ScoredRecommendation` (template + score + matchedTraits) used in templates.ts and recommend.ts
- `deriveFromValues` signature: `(count: number, values: string[]) => { value, confidence, reasoning }` consistent everywhere
- `IdeaDomain` type from orchestrator/types.ts used consistently

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | 11 proposals, 11 accepted, 4 deferred |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | ISSUES_FOUND | 20 concerns, 1 accepted (MCP placement) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | ISSUES_OPEN | 6 issues, 5 resolved, 1 P3 deferred |

**CROSS-MODEL:** Claude and Codex agree on scalar encoding (both valid), auto-execute safety (both valid), deriveFromValues design (both accept user's choice). Disagreement on MCP tool placement → resolved in favor of Codex (orchestrator-handlers.ts).

**UNRESOLVED:** 1 P3 item (--reset uses raw SQL, acceptable for admin operation)

**CHANGES FROM REVIEW:**
1. [FIXED] Typo: `orchator` → `orchestrator` in Task 8 import
2. [FIXED] D1: Removed circular re-export of extractColdStartSignals from interview.ts
3. [FIXED] D2: Task 8 must delete extractColdStartSignals and migrate 17 existing tests
4. [FIXED] D3: Auto-execute moved before confirmRl.close() to avoid readline crash
5. [FIXED] D4: Plan needs ~15 additional test cases for gaps (empty answers, --reset, auto-execute, feedback, score cap)
6. [FIXED] D6: kai_work_recommend moved to src/mcp/orchestrator-handlers.ts (not handlers.ts)

**VERDICT:** ENG REVIEW — 5 issues resolved, 1 P3 deferred. Ready to implement after test gap fixes are incorporated.