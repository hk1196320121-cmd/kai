import { describe, test, expect } from "bun:test";
import {
  TOOL_DOMAIN_MAP,
  TOOL_SLASH_MAP,
  TOOL_DESCRIPTIONS,
  SCHEMA_TO_TOOL_MAP,
  getToolsByDomain,
  buildSkillConfigs,
  sanitizeToolName,
  sanitizeDomainName,
} from "../../../src/cli/skills/compiler";

describe("compiler.ts", () => {
  describe("TOOL_DOMAIN_MAP", () => {
    test("maps every known MCP tool to a domain", () => {
      const knownTools = [
        "profile.read",
        "profile.why",
        "observe.submit",
        "observe.batch",
        "derive.trigger",
        "kai_work_recommend",
        "kai_execution_status",
        "kai_idea_submit",
        "kai_idea_plan",
        "kai_plan_approve",
        "kai_task_execute",
        "kai_idea_pause",
        "kai_replan",
        "prompt.compile",
        "prompt.champion",
        "prompt.evolve",
        "telemetry.query",
        "telemetry.trace",
        "telemetry.explain",
      ];
      for (const tool of knownTools) {
        expect(
          TOOL_DOMAIN_MAP[tool],
          `Missing domain mapping for ${tool}`,
        ).toBeDefined();
      }
    });

    test("all domains are valid directory names", () => {
      const domains = new Set(Object.values(TOOL_DOMAIN_MAP));
      for (const domain of domains) {
        expect(domain).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });
  });

  describe("SCHEMA_TO_TOOL_MAP", () => {
    test("maps every schema export name to a tool ID", () => {
      const expectedMappings: Record<string, string> = {
        ProfileReadSchema: "profile.read",
        ProfileWhySchema: "profile.why",
        ObserveSubmitSchema: "observe.submit",
        ObserveBatchSchema: "observe.batch",
        DeriveTriggerSchema: "derive.trigger",
        WorkRecommendSchema: "kai_work_recommend",
        IdeaSubmitSchema: "kai_idea_submit",
        IdeaPlanSchema: "kai_idea_plan",
        PlanApproveSchema: "kai_plan_approve",
        TaskExecuteSchema: "kai_task_execute",
        IdeaPauseSchema: "kai_idea_pause",
        ExecutionStatusSchema: "kai_execution_status",
        ReplanSchema: "kai_replan",
        PromptCompileSchema: "prompt.compile",
        PromptChampionSchema: "prompt.champion",
        PromptEvolveSchema: "prompt.evolve",
        TelemetryQuerySchema: "telemetry.query",
        TelemetryTraceSchema: "telemetry.trace",
        TelemetryExplainSchema: "telemetry.explain",
      };
      for (const [schema, toolId] of Object.entries(expectedMappings)) {
        expect(
          SCHEMA_TO_TOOL_MAP[schema],
          `Missing mapping for ${schema}`,
        ).toBe(toolId);
      }
    });
  });

  describe("getToolsByDomain", () => {
    test("groups tools into expected domains", () => {
      const grouped = getToolsByDomain();
      expect(Object.keys(grouped).sort()).toEqual(
        [
          "derive",
          "idea",
          "observe",
          "profile",
          "prompt",
          "telemetry",
          "work",
        ].sort(),
      );
    });

    test("profile domain contains profile.read and profile.why", () => {
      const grouped = getToolsByDomain();
      const profileTools = grouped["profile"]
        .map((t) => t.toolId)
        .sort();
      expect(profileTools).toEqual(["profile.read", "profile.why"]);
    });

    test("idea domain contains 6 orchestrator tools", () => {
      const grouped = getToolsByDomain();
      const ideaTools = grouped["idea"].map((t) => t.toolId);
      expect(ideaTools).toHaveLength(6);
      expect(ideaTools).toContain("kai_idea_submit");
      expect(ideaTools).toContain("kai_replan");
    });

    test("every tool has a non-empty slashCommand", () => {
      const grouped = getToolsByDomain();
      for (const [, tools] of Object.entries(grouped)) {
        for (const tool of tools) {
          expect(tool.slashCommand.length).toBeGreaterThan(0);
          expect(tool.slashCommand).toMatch(/^\/kai-/);
        }
      }
    });
  });

  describe("buildSkillConfigs", () => {
    test("returns 7 domain skill configs", () => {
      const configs = buildSkillConfigs();
      expect(configs).toHaveLength(7);
    });

    test("total tool count across all skills is 19", () => {
      const configs = buildSkillConfigs();
      const totalTools = configs.reduce((sum, c) => sum + c.tools.length, 0);
      expect(totalTools).toBe(19);
    });
  });

  describe("sanitizeToolName", () => {
    test("accepts valid tool names", () => {
      expect(sanitizeToolName("profile.read")).toBe("profile.read");
      expect(sanitizeToolName("kai_idea_submit")).toBe("kai_idea_submit");
    });

    test("rejects path traversal", () => {
      expect(() => sanitizeToolName("../etc/passwd")).toThrow(/invalid/i);
      expect(() => sanitizeToolName("foo../../bar")).toThrow(/invalid/i);
    });

    test("rejects empty string", () => {
      expect(() => sanitizeToolName("")).toThrow(/invalid/i);
    });
  });

  describe("sanitizeDomainName", () => {
    test("accepts valid domain names", () => {
      expect(sanitizeDomainName("profile")).toBe("profile");
      expect(sanitizeDomainName("observe")).toBe("observe");
    });

    test("rejects names with slashes", () => {
      expect(() => sanitizeDomainName("foo/bar")).toThrow(/invalid/i);
    });

    test("rejects path traversal", () => {
      expect(() => sanitizeDomainName("..")).toThrow(/invalid/i);
    });
  });

  describe("map consistency", () => {
    test("every tool in TOOL_DOMAIN_MAP has a slash command", () => {
      for (const toolId of Object.keys(TOOL_DOMAIN_MAP)) {
        expect(
          TOOL_SLASH_MAP[toolId],
          `Missing slash command for ${toolId}`,
        ).toBeDefined();
        expect(
          TOOL_SLASH_MAP[toolId].length,
          `Empty slash command for ${toolId}`,
        ).toBeGreaterThan(0);
      }
    });

    test("every tool in TOOL_DOMAIN_MAP has a description", () => {
      for (const toolId of Object.keys(TOOL_DOMAIN_MAP)) {
        expect(
          TOOL_DESCRIPTIONS[toolId],
          `Missing description for ${toolId}`,
        ).toBeDefined();
        expect(
          TOOL_DESCRIPTIONS[toolId].length,
          `Empty description for ${toolId}`,
        ).toBeGreaterThan(0);
      }
    });

    test("every tool in buildSkillConfigs has a non-empty schemaExportName", () => {
      const configs = buildSkillConfigs();
      for (const config of configs) {
        for (const tool of config.tools) {
          expect(
            tool.schemaExportName.length,
            `Empty schemaExportName for ${tool.toolId}`,
          ).toBeGreaterThan(0);
        }
      }
    });

    test("TOOL_SLASH_MAP keys match TOOL_DOMAIN_MAP keys", () => {
      const domainKeys = new Set(Object.keys(TOOL_DOMAIN_MAP));
      const slashKeys = new Set(Object.keys(TOOL_SLASH_MAP));
      expect(slashKeys).toEqual(domainKeys);
    });

    test("SCHEMA_TO_TOOL_MAP values match TOOL_DOMAIN_MAP keys", () => {
      const domainKeys = new Set(Object.keys(TOOL_DOMAIN_MAP));
      const schemaValues = new Set(Object.values(SCHEMA_TO_TOOL_MAP));
      expect(schemaValues).toEqual(domainKeys);
    });
  });

  describe("sanitizeToolName edge cases", () => {
    test("rejects names with spaces", () => {
      expect(() => sanitizeToolName("foo bar")).toThrow(/invalid/i);
    });

    test("rejects shell metacharacters", () => {
      expect(() => sanitizeToolName("foo$(rm -rf /)")).toThrow(/invalid/i);
      expect(() => sanitizeToolName("foo;bar")).toThrow(/invalid/i);
    });
  });

  describe("sanitizeDomainName edge cases", () => {
    test("rejects uppercase", () => {
      expect(() => sanitizeDomainName("Profile")).toThrow(/invalid/i);
    });

    test("rejects leading digit", () => {
      expect(() => sanitizeDomainName("1profile")).toThrow(/invalid/i);
    });

    test("rejects dots", () => {
      expect(() => sanitizeDomainName("pro.file")).toThrow(/invalid/i);
    });

    test("rejects underscores", () => {
      expect(() => sanitizeDomainName("pro_file")).toThrow(/invalid/i);
    });
  });
});
