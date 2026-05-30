import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RULES } from "../../../src/core/profile/rules";
import { KaiDB } from "../../../src/db/client";

describe("Autopilot rules (5 new tool_usage rules)", () => {
	// Find the autopilot-specific rules by testing their match functions
	const autopilotRuleDimensions = [
		"autonomy",
		"detail_oriented",
		"exploratory",
		"code_focus",
		"planning_style",
	];

	test("5 new autopilot rule dimensions exist in RULES", () => {
		const dimensions = RULES.map((r) => r.dimension);
		for (const dim of autopilotRuleDimensions) {
			// These dimensions may already exist from coldstart rules too,
			// so we check that there are rules targeting them
			expect(dimensions.filter((d) => d === dim).length).toBeGreaterThanOrEqual(1);
		}
	});

	test("autonomy rule matches Bash tool_usage observations", () => {
		const autonomyRules = RULES.filter((r) => r.dimension === "autonomy");
		const matchesBash = autonomyRules.some((r) =>
			r.match("Bash", '{"tool":"Bash"}'),
		);
		expect(matchesBash).toBe(true);
	});

	test("detail_oriented rule matches Edit tool_usage observations", () => {
		const detailRules = RULES.filter((r) => r.dimension === "detail_oriented");
		const matchesEdit = detailRules.some((r) =>
			r.match("Edit", '{"tool":"Edit"}'),
		);
		expect(matchesEdit).toBe(true);
	});

	test("exploratory rule matches Grep, Glob, WebSearch tool_usage", () => {
		const exploratoryRules = RULES.filter((r) => r.dimension === "exploratory");
		const matchesGrep = exploratoryRules.some((r) =>
			r.match("Grep", '{"tool":"Grep"}'),
		);
		const matchesGlob = exploratoryRules.some((r) =>
			r.match("Glob", '{"tool":"Glob"}'),
		);
		const matchesWebSearch = exploratoryRules.some((r) =>
			r.match("WebSearch", '{"tool":"WebSearch"}'),
		);
		expect(matchesGrep).toBe(true);
		expect(matchesGlob).toBe(true);
		expect(matchesWebSearch).toBe(true);
	});

	test("code_focus rule matches Edit, Write, Read tool_usage", () => {
		const codeFocusRules = RULES.filter((r) => r.dimension === "code_focus");
		const matchesEdit = codeFocusRules.some((r) =>
			r.match("Edit", '{"tool":"Edit"}'),
		);
		const matchesWrite = codeFocusRules.some((r) =>
			r.match("Write", '{"tool":"Write"}'),
		);
		const matchesRead = codeFocusRules.some((r) =>
			r.match("Read", '{"tool":"Read"}'),
		);
		expect(matchesEdit).toBe(true);
		expect(matchesWrite).toBe(true);
		expect(matchesRead).toBe(true);
	});

	test("planning_style rule matches TodoRead and TodoWrite", () => {
		const planningRules = RULES.filter((r) => r.dimension === "planning_style");
		const matchesTodoRead = planningRules.some((r) =>
			r.match("TodoRead", '{"tool":"TodoRead"}'),
		);
		const matchesTodoWrite = planningRules.some((r) =>
			r.match("TodoWrite", '{"tool":"TodoWrite"}'),
		);
		expect(matchesTodoRead).toBe(true);
		expect(matchesTodoWrite).toBe(true);
	});

	test("autopilot rules reject non-JSON values gracefully", () => {
		const autonomyRules = RULES.filter(
			(r) =>
				r.dimension === "autonomy" &&
				// The autopilot-specific rule that parses JSON
				r.match.toString().includes("JSON.parse"),
		);
		for (const rule of autonomyRules) {
			// Non-JSON value should not match
			expect(rule.match("Bash", "not-json")).toBe(false);
		}
	});

	test("autopilot rules reject wrong tool names", () => {
		const autonomyRules = RULES.filter((r) => r.dimension === "autonomy");
		const matchesWrong = autonomyRules.some((r) =>
			r.match("Bash", '{"tool":"Read"}'),
		);
		// Autonomy Bash rule should NOT match when tool=Read
		expect(matchesWrong).toBe(false);
	});

	test("derive functions return value capped at 1.0", () => {
		const autonomyRules = RULES.filter(
			(r) =>
				r.dimension === "autonomy" &&
				r.match("Bash", '{"tool":"Bash"}'),
		);
		for (const rule of autonomyRules) {
			const derived = rule.derive(1000);
			expect(derived.value).toBeLessThanOrEqual(1.0);
		}
	});

	test("derive functions return confidence capped at 10", () => {
		for (const dim of autopilotRuleDimensions) {
			const rules = RULES.filter((r) => r.dimension === dim);
			for (const rule of rules) {
				const derived = rule.derive(1000);
				expect(derived.confidence).toBeLessThanOrEqual(10);
			}
		}
	});
});

describe("Autopilot rules: derive output structure", () => {
	test("each rule derive returns value, confidence, reasoning", () => {
		const autopilotDims = new Set([
			"autonomy",
			"detail_oriented",
			"exploratory",
			"code_focus",
			"planning_style",
		]);
		const rules = RULES.filter((r) => autopilotDims.has(r.dimension));
		for (const rule of rules) {
			const derived = rule.derive(5);
			expect(typeof derived.value).toBe("number");
			expect(typeof derived.confidence).toBe("number");
			expect(typeof derived.reasoning).toBe("string");
			expect(derived.reasoning.length).toBeGreaterThan(0);
		}
	});
});
