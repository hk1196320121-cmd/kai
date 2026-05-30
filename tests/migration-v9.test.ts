import { describe, test, expect } from "bun:test";
import {
	VALID_OBSERVATION_TYPES,
	VALID_OBSERVATION_SOURCES,
	sqlTypeCheck,
	sqlSourceCheck,
} from "../src/core/profile/types";
import type { Observation } from "../src/core/profile/types";

describe("Observation type constants (D12)", () => {
	test("VALID_OBSERVATION_TYPES includes tool_usage", () => {
		expect(VALID_OBSERVATION_TYPES).toContain("tool_usage");
		expect(VALID_OBSERVATION_TYPES).toContain("behavior");
		expect(VALID_OBSERVATION_TYPES).toContain("signal");
	});

	test("VALID_OBSERVATION_SOURCES includes auto_observe", () => {
		expect(VALID_OBSERVATION_SOURCES).toContain("auto_observe");
		expect(VALID_OBSERVATION_SOURCES).toContain("hook_error");
	});

	test("constants match TypeScript union", () => {
		type FromConst = (typeof VALID_OBSERVATION_TYPES)[number];
		type FromUnion = Observation["type"];
		const _check: FromConst extends FromUnion ? true : false = true;
		expect(_check).toBe(true);
	});

	test("sqlTypeCheck generates valid SQL CHECK clause", () => {
		const sql = sqlTypeCheck();
		expect(sql).toMatch(/^CHECK\(type IN \(/);
		expect(sql).toContain("'behavior'");
		expect(sql).toContain("'tool_usage'");
	});

	test("sqlSourceCheck generates valid SQL CHECK clause", () => {
		const sql = sqlSourceCheck();
		expect(sql).toMatch(/^CHECK\(source IN \(/);
		expect(sql).toContain("'auto_observe'");
		expect(sql).toContain("'hook_error'");
	});
});
