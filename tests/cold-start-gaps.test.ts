import { describe, test, expect, afterEach } from "bun:test";
import { scanGitHistory } from "../src/cli/work";
import { InterviewEngine } from "../src/core/profile/interview";
import { cleanup, tempDb } from "./helpers/temp-db";

const engine = new InterviewEngine();

describe("extractColdStartSignals - domain detection", () => {
	test("detects engineering domain from answer text", () => {
		const signals = engine.extractSignalsFromAnswers(
			[{ slug: "goal", text: "I want to debug the API and deploy new code" }],
			[],
			"ws-1",
		);
		const domain = signals.find((s) => s.key === "coldstart:signal.domain");
		expect(domain).toBeDefined();
		const val = JSON.parse(domain!.value);
		expect(val.domains).toContain("engineering");
	});

	test("detects design domain from answer text", () => {
		const signals = engine.extractSignalsFromAnswers(
			[{ slug: "goal", text: "I want to improve the UX and create wireframes" }],
			[],
			"ws-2",
		);
		const domain = signals.find((s) => s.key === "coldstart:signal.domain");
		expect(domain).toBeDefined();
		const val = JSON.parse(domain!.value);
		expect(val.domains).toContain("design");
	});

	test("detects management domain from answer text", () => {
		const signals = engine.extractSignalsFromAnswers(
			[
				{
					slug: "goal",
					text: "I need to manage my team's sprint and update the roadmap",
				},
			],
			[],
			"ws-3",
		);
		const domain = signals.find((s) => s.key === "coldstart:signal.domain");
		expect(domain).toBeDefined();
		const val = JSON.parse(domain!.value);
		expect(val.domains).toContain("management");
	});

	test("detects research domain from answer text", () => {
		const signals = engine.extractSignalsFromAnswers(
			[
				{
					slug: "goal",
					text: "I want to read a research paper and do data analysis",
				},
			],
			[],
			"ws-4",
		);
		const domain = signals.find((s) => s.key === "coldstart:signal.domain");
		expect(domain).toBeDefined();
		const val = JSON.parse(domain!.value);
		expect(val.domains).toContain("research");
	});

	test("detects writing domain from answer text", () => {
		const signals = engine.extractSignalsFromAnswers(
			[{ slug: "goal", text: "I want to write a blog post and document the content" }],
			[],
			"ws-5",
		);
		const domain = signals.find((s) => s.key === "coldstart:signal.domain");
		expect(domain).toBeDefined();
		const val = JSON.parse(domain!.value);
		expect(val.domains).toContain("writing");
	});

	test("does not emit domain signal for answers with no domain keywords", () => {
		const signals = engine.extractSignalsFromAnswers(
			[{ slug: "goal", text: "just thinking about stuff" }],
			[],
			"ws-6",
		);
		const domain = signals.find((s) => s.key === "coldstart:signal.domain");
		expect(domain).toBeUndefined();
	});

	test("gitHints detail_oriented adds engineering to domains", () => {
		const signals = engine.extractSignalsFromAnswers(
			[{ slug: "goal", text: "I want to design wireframes" }],
			[{ dimension: "detail_oriented", hints: ["long commit messages"] }],
			"ws-7",
		);
		const domain = signals.find((s) => s.key === "coldstart:signal.domain");
		expect(domain).toBeDefined();
		const val = JSON.parse(domain!.value);
		expect(val.domains).toContain("design");
		expect(val.domains).toContain("engineering");
	});

	test("deduplicates domains", () => {
		const signals = engine.extractSignalsFromAnswers(
			[{ slug: "goal", text: "debug code and deploy API" }],
			[{ dimension: "detail_oriented", hints: ["long commits"] }],
			"ws-8",
		);
		const domain = signals.find((s) => s.key === "coldstart:signal.domain");
		expect(domain).toBeDefined();
		const val = JSON.parse(domain!.value);
		const engineeringCount = val.domains.filter(
			(d: string) => d === "engineering",
		).length;
		expect(engineeringCount).toBe(1);
	});
});

describe("extractColdStartSignals - edge cases", () => {
	test("empty answers array produces no per-answer signals", () => {
		const signals = engine.extractSignalsFromAnswers([], [], "ws-empty");
		const goalSignal = signals.find((s) => s.key === "coldstart:goal");
		expect(goalSignal).toBeUndefined();
	});

	test("single short answer produces low detail and terse style", () => {
		const signals = engine.extractSignalsFromAnswers(
			[{ slug: "goal", text: "fix bug" }],
			[],
			"ws-short",
		);
		const detail = signals.find(
			(s) => s.key === "coldstart:signal.detail_level",
		);
		expect(detail).toBeDefined();
		const detailVal = JSON.parse(detail!.value);
		expect(detailVal.level).toBe("low");

		const commStyle = signals.find(
			(s) => s.key === "coldstart:signal.comm_style",
		);
		expect(commStyle).toBeDefined();
		const commVal = JSON.parse(commStyle!.value);
		expect(commVal.style).toBe("terse");
	});

	test("has_specifics flag set when answer contains numbers", () => {
		const signals = engine.extractSignalsFromAnswers(
			[{ slug: "goal", text: "I need exactly 5 features by 2024" }],
			[],
			"ws-specifics",
		);
		const detail = signals.find(
			(s) => s.key === "coldstart:signal.detail_level",
		);
		expect(detail).toBeDefined();
		const val = JSON.parse(detail!.value);
		expect(val.has_specifics).toBe(true);
	});

	test("provenance includes origin and extractor_version", () => {
		const signals = engine.extractSignalsFromAnswers(
			[{ slug: "goal", text: "test" }],
			[],
			"ws-prov",
		);
		const prov = JSON.parse(signals[0].provenance);
		expect(prov.origin).toBe("kai work start");
		expect(prov.extractor_version).toBe("2.0.0");
	});
});
