import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { buildSkillConfigs, sanitizeDomainName } from "../compiler";
import { getHookConfigs, writeHookScripts } from "../hooks";
import { ClaudeCodeTarget } from "../targets/claude-code";
import { generateMasterSkill, generateSkillMarkdown } from "../templates";
import type { McpConfig, SkillManifest } from "../types";
import { WORKFLOWS } from "../workflows/definitions";
import { CommandGenerator } from "../workflows/generator";
import { getBakedTraits } from "./profile-aware";

export async function installSkills(opts: {
  target: string;
  force?: boolean;
  configureMcp?: boolean;
  installPath?: string;
  _testPaths?: {
    claudeJsonPath?: string;
    settingsJsonPath?: string;
    commandsDir?: string;
    hooksDir?: string;
  };
}): Promise<number> {
  if (opts.target !== "claude-code") {
    throw new Error(
      `Target "${opts.target}" is not supported. Only "claude-code" is available.`,
    );
  }

  const tp = opts._testPaths;
  const target = new ClaudeCodeTarget(
    opts.installPath,
    tp?.claudeJsonPath,
    tp?.settingsJsonPath,
    tp?.commandsDir,
    tp?.hooksDir,
  );
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

    // --- Generate workflow commands ---
    const commandsDir = target.commandsDir;
    mkdirSync(commandsDir, { recursive: true });

    // Read profile for trait baking
    let bakedTraits: Map<string, number>;
    try {
      const { getEngine } = await import("../../utils");
      const { db, engine } = getEngine();
      const snapshot = engine.getProfile();
      bakedTraits = getBakedTraits(snapshot);
      db.close();
      if (bakedTraits.size === 0) {
        console.log(
          "Warning: Profile is empty. Commands will use defaults until profile is built.",
        );
        console.log("  Run `kai work start` to build your profile.");
      }
    } catch (e) {
      console.log(
        "Warning: Could not load profile. Commands will use defaults.",
      );
      bakedTraits = new Map();
    }

    const gen = new CommandGenerator(bakedTraits);
    const commands = gen.generateAll(WORKFLOWS);
    for (const cmd of commands) {
      writeFileSync(join(commandsDir, `${cmd.name}.md`), cmd.content);
    }
    console.log(
      `Installed ${commands.length} slash commands to ${commandsDir}`,
    );

    // --- Generate hook scripts ---
    const hooksDir = target.hooksDir;
    writeHookScripts(hooksDir);
    console.log(`Installed hook scripts to ${hooksDir}`);

    // --- Merge hooks into settings.json ---
    const hookConfigs = getHookConfigs(hooksDir);
    for (const hc of hookConfigs) {
      await target.mergeSettingsHook(hc);
    }
    console.log("Merged hooks into ~/.claude/settings.json");
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
