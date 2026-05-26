import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { buildSkillConfigs, sanitizeDomainName } from "../compiler";
import { ClaudeCodeTarget } from "../targets/claude-code";
import { generateMasterSkill, generateSkillMarkdown } from "../templates";
import type { McpConfig, SkillManifest } from "../types";

export async function installSkills(opts: {
  target: string;
  force?: boolean;
  configureMcp?: boolean;
}): Promise<number> {
  if (opts.target !== "claude-code") {
    throw new Error(
      `Target "${opts.target}" is not supported. Only "claude-code" is available.`,
    );
  }

  const target = new ClaudeCodeTarget();
  const installPath = target.skillInstallPath;

  const alreadyInstalled =
    existsSync(join(installPath, "manifest.json")) && !opts.force;

  if (alreadyInstalled && !opts.configureMcp) {
    console.log(
      `Skills already installed at ${installPath}. Use --force to overwrite.`,
    );
    return 0;
  }

  if (alreadyInstalled) {
    console.log(
      `Skills already installed at ${installPath}. Skipping file generation; configuring MCP only.`,
    );
  }

  if (!alreadyInstalled) {
    // Warn if overwriting existing files without manifest (partial/corrupted install)
    if (existsSync(installPath) && !opts.force) {
      console.log(
        `Warning: Overwriting existing files at ${installPath}. Custom edits will be lost.`,
      );
    }

    const configs = buildSkillConfigs();

    // Generate skill files
    mkdirSync(installPath, { recursive: true });

    // Master SKILL.md
    const masterMd = generateMasterSkill(configs);
    writeFileSync(join(installPath, "SKILL.md"), masterMd);

    // Domain-specific SKILL.md files
    for (const config of configs) {
      const domain = sanitizeDomainName(config.domain);
      const domainDir = join(installPath, domain);
      mkdirSync(domainDir, { recursive: true });
      const md = generateSkillMarkdown(config);
      writeFileSync(join(domainDir, "SKILL.md"), md);
    }

    // Write manifest
    const pkg = JSON.parse(
      readFileSync(
        new URL("../../../../package.json", import.meta.url),
        "utf-8",
      ),
    );
    const manifest: SkillManifest = {
      kaiVersion: pkg.version,
      generatedAt: new Date().toISOString(),
      skills: Object.fromEntries(
        configs.map((c) => [c.domain, c.tools.map((t) => t.toolId)]),
      ),
    };
    writeFileSync(
      join(installPath, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    console.log(`Installed skill files to ${installPath}`);
  }

  // Configure MCP if requested
  if (opts.configureMcp) {
    const mcpConfig: McpConfig = { command: "kai", args: ["mcp", "serve"] };
    try {
      await target.configureMcp(mcpConfig, opts.force);
      console.log("Added MCP server configuration to ~/.claude.json");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Error configuring MCP: ${msg}`);
    }
  } else {
    console.log("\nTo complete setup, add the MCP server to ~/.claude.json.");
    console.log("Run with --configure-mcp for automatic configuration.");
  }

  return 0;
}

export function registerInstallCommand(skills: Command): void {
  skills
    .command("install")
    .description("Generate and install skill files")
    .option(
      "--target <target>",
      "Target agent (default: claude-code)",
      "claude-code",
    )
    .option("--force", "Overwrite existing skills without prompting")
    .option(
      "--configure-mcp",
      "Automatically configure MCP server in ~/.claude.json",
    )
    .action(
      async (opts: {
        target: string;
        force?: boolean;
        configureMcp?: boolean;
      }) => {
        await installSkills(opts);
      },
    );
}
