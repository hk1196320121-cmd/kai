import { describe, test, expect } from "bun:test";
import { generateSkillMarkdown, generateMasterSkill } from "../../../src/cli/skills/templates";
import { buildSkillConfigs } from "../../../src/cli/skills/compiler";
import type { SkillConfig } from "../../../src/cli/skills/types";

describe("templates.ts", () => {
  const configs = buildSkillConfigs();

  describe("generateSkillMarkdown", () => {
    test("generates valid YAML frontmatter for each domain", () => {
      for (const config of configs) {
        const md = generateSkillMarkdown(config);
        expect(md).toMatch(/^---\n/);
        expect(md).toContain("name:");
        expect(md).toContain("description:");
        expect(md).toContain("allowed-tools:");
        expect(md).toMatch(/\n---\n/);
      }
    });

    test("includes all slash commands in description", () => {
      for (const config of configs) {
        const md = generateSkillMarkdown(config);
        for (const cmd of config.slashCommands) {
          expect(md, `Missing slash command ${cmd} in ${config.domain}`).toContain(cmd);
        }
      }
    });

    test("includes allowed-tools entries for all MCP tools", () => {
      for (const config of configs) {
        const md = generateSkillMarkdown(config);
        for (const tool of config.tools) {
          expect(md, `Missing MCP tool ref for ${tool.toolId} in ${config.domain}`).toContain("mcp__kai__");
        }
      }
    });

    test("includes Parameters section", () => {
      for (const config of configs) {
        const md = generateSkillMarkdown(config);
        expect(md).toContain("### Parameters");
      }
    });

    test("includes Examples section", () => {
      for (const config of configs) {
        const md = generateSkillMarkdown(config);
        expect(md).toContain("## Examples");
      }
    });

    test("includes MCP resource references when domain has resources", () => {
      const profileConfig = configs.find(c => c.domain === "profile")!;
      const md = generateSkillMarkdown(profileConfig);
      expect(md).toContain("kai://profile/");
    });

    test("domain without resources does not include resource section", () => {
      const deriveConfig = configs.find(c => c.domain === "derive")!;
      const md = generateSkillMarkdown(deriveConfig);
      expect(md).not.toContain("### MCP Resources");
    });
  });

  describe("generateMasterSkill", () => {
    test("generates master SKILL.md with all domains listed", () => {
      const md = generateMasterSkill(configs);
      expect(md).toMatch(/^---\n/);
      expect(md).toContain("name: kai");
      expect(md).toContain("/kai");
      for (const config of configs) {
        expect(md, `Missing domain ${config.domain}`).toContain(config.domain);
      }
    });

    test("lists all slash commands grouped by domain", () => {
      const md = generateMasterSkill(configs);
      for (const config of configs) {
        for (const cmd of config.slashCommands) {
          expect(md, `Missing command ${cmd}`).toContain(cmd);
        }
      }
    });
  });
});
