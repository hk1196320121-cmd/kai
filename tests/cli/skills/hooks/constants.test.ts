import { describe, test, expect } from "bun:test";
import {
	MIN_SCHEMA_VERSION,
	ALLOWED_TOOLS,
	BUSY_TIMEOUT_MS,
} from "../../../../src/cli/skills/hooks/constants";

describe("constants.ts (shared hook constants)", () => {
	test("MIN_SCHEMA_VERSION is 9", () => {
		expect(MIN_SCHEMA_VERSION).toBe(9);
	});

	test("ALLOWED_TOOLS contains required tool categories", () => {
		expect(ALLOWED_TOOLS).toContain("Edit");
		expect(ALLOWED_TOOLS).toContain("Write");
		expect(ALLOWED_TOOLS).toContain("Read");
		expect(ALLOWED_TOOLS).toContain("Bash");
		expect(ALLOWED_TOOLS).toContain("Grep");
		expect(ALLOWED_TOOLS).toContain("Glob");
		expect(ALLOWED_TOOLS).toContain("WebSearch");
		expect(ALLOWED_TOOLS).toContain("WebFetch");
		expect(ALLOWED_TOOLS).toContain("TodoRead");
		expect(ALLOWED_TOOLS).toContain("TodoWrite");
		expect(ALLOWED_TOOLS).toContain("MultiEdit");
	});

	test("ALLOWED_TOOLS does NOT contain non-behavioral tools", () => {
		// These tools are NOT behaviorally meaningful for profiling and must not be in allowlist
		expect(ALLOWED_TOOLS as readonly string[]).not.toContain("NotebookEdit");
		expect(ALLOWED_TOOLS as readonly string[]).not.toContain("SomePlugin");
		expect(ALLOWED_TOOLS as readonly string[]).not.toContain("LSP");
		expect(ALLOWED_TOOLS as readonly string[]).not.toContain("TaskCreate");
		expect(ALLOWED_TOOLS as readonly string[]).not.toContain("CronCreate");
	});

	test("ALLOWED_TOOLS has exactly 11 entries", () => {
		expect(ALLOWED_TOOLS).toHaveLength(11);
	});

	test("BUSY_TIMEOUT_MS is 5000", () => {
		expect(BUSY_TIMEOUT_MS).toBe(5000);
	});

	test("constants are frozen/read-only (as const)", () => {
		// as const arrays are readonly at type level; verify runtime length
		expect(Array.isArray(ALLOWED_TOOLS)).toBe(true);
		expect(typeof MIN_SCHEMA_VERSION).toBe("number");
		expect(typeof BUSY_TIMEOUT_MS).toBe("number");
	});
});
