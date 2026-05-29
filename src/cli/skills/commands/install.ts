import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolve as resolvePath } from "node:path";
import { execSync } from "node:child_process";
import type { Command } from "commander";
import { buildSkillConfigs, sanitizeDomainName } from "../compiler";
import { detectPlatforms, getTarget, validateTargetName } from "../targets/registry";
import { generateMasterSkill, generateSkillMarkdown } from "../templates";
import type { McpConfig, SkillFile, SkillManifest } from "../types";
import type { TargetAdapter } from "../targets/types";

function resolveKaiCommand(): string {
  try {
    const which = execSync("which kai 2>/dev/null", { encoding: "utf-8" }).trim();
    if (which && existsSync(which)) return resolvePath(which);
  } catch {}
  const kaiPath = process.argv[1];
  if (kaiPath && existsSync(kaiPath)) return resolvePath(kaiPath);
  return "kai";
}

async function buildAdapter(targetName: string, opts?: {
  installPath?: string;
  _testPaths?: Record<string, string | undefined>;
}): Promise<TargetAdapter> {
  if (opts?.installPath || opts?._testPaths) {
    const tp = opts._testPaths;
    switch (targetName) {
      case "claude-code": {
        const { ClaudeCodeTarget } = await import("../targets/claude-code");
        return new ClaudeCodeTarget(
          opts.installPath,
          tp?.claudeJsonPath,
          tp?.settingsJsonPath,
          tp?.commandsDir,
          tp?.hooksDir,
        );
      }
      case "hermes": {
        const { HermesTarget } = await import("../targets/hermes");
        return new HermesTarget(opts.installPath, tp?.configPath);
      }
      case "gemini-cli": {
        const { GeminiCliTarget } = await import("../targets/gemini-cli");
        return new GeminiCliTarget(opts.installPath, tp?.settingsPath);
      }
      default:
        return getTarget(targetName);
    }
  }
  return getTarget(targetName);
}

async function installToTarget(
  targetName: string,
  opts: {
    force?: boolean;
    configureMcp?: boolean;
    installPath?: string;
    _testPaths?: Record<string, string | undefined>;
  },
): Promise<{ target: string; success: boolean; message: string }> {
  const adapter = await buildAdapter(targetName, opts);
  const caps = adapter.capabilities();

  const alreadyInstalled =
    existsSync(join(adapter.skillInstallPath, "manifest.json")) && !opts.force;

  if (alreadyInstalled && !opts.configureMcp) {
    return {
      target: targetName,
      success: true,
      message: `Skills already installed at ${adapter.skillInstallPath}. Use --force to overwrite.`,
    };
  }

  if (!alreadyInstalled) {
    // Build skill files
    const configs = buildSkillConfigs();
    const skills: SkillFile[] = [];

    // Master SKILL.md
    skills.push({ filename: "SKILL.md", content: generateMasterSkill(configs) });

    // Domain-specific SKILL.md files
    for (const config of configs) {
      const domain = sanitizeDomainName(config.domain);
      skills.push({
        filename: `${domain}/SKILL.md`,
        content: generateSkillMarkdown(config),
      });
    }

    // Build manifest
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
      target: targetName,
    };

    // Delegate to adapter (writes skill files + manifest + commands + hooks)
    await adapter.installSkills(skills, manifest);
    console.log(`Installed skill files to ${adapter.skillInstallPath}`);
  }

  // Configure MCP if requested (capability-gated)
  if (opts.configureMcp && caps.mcp) {
    const mcpConfig: McpConfig = {
      command: resolveKaiCommand(),
      args: ["mcp", "serve"],
    };
    try {
      await adapter.configureMcp(mcpConfig, opts.force);
      console.log(`Configured MCP server for ${targetName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        target: targetName,
        success: false,
        message: `Error configuring MCP: ${msg}`,
      };
    }
  }

  // Auto-verify
  const validation = adapter.validateInstallation();
  if (!validation.valid) {
    return {
      target: targetName,
      success: false,
      message: `Installation verification failed: ${validation.errors.join("; ")}`,
    };
  }

  if (!opts.configureMcp) {
    console.log("\nTo complete setup, add the MCP server.");
    console.log("Run with --configure-mcp for automatic configuration.");
  }

  return {
    target: targetName,
    success: true,
    message: `Installed to ${adapter.skillInstallPath}${opts.configureMcp ? " + MCP configured" : ""}`,
  };
}

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
    configPath?: string;
    settingsPath?: string;
  };
}): Promise<number> {
  const targetNames: string[] = [];

  if (opts.target === "all") {
    const detected = detectPlatforms();
    if (detected.length === 0 && !opts.force) {
      console.log("No AI platforms detected. Use --force to install to all registered platforms.");
      return 1;
    }
    targetNames.push(...(opts.force ? ["claude-code", "hermes", "gemini-cli"] : detected));
  } else {
    validateTargetName(opts.target);
    targetNames.push(opts.target);
  }

  let hasError = false;

  for (const name of targetNames) {
    try {
      const result = await installToTarget(name, opts);
      if (result.success) {
        console.log(`[${result.target}] ${result.message}`);
      } else {
        console.log(`[${result.target}] ERROR: ${result.message}`);
        hasError = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[${name}] ERROR: ${msg}`);
      hasError = true;
    }
  }

  return hasError ? 1 : 0;
}

export function registerInstallCommand(skills: Command): void {
  skills
    .command("install")
    .description("Generate and install skill files")
    .option(
      "--target <target>",
      "Target agent (claude-code, hermes, gemini-cli, all)",
      "claude-code",
    )
    .option("--force", "Overwrite existing skills without prompting")
    .option(
      "--configure-mcp",
      "Automatically configure MCP server",
    )
    .action(
      async (opts: {
        target: string;
        force?: boolean;
        configureMcp?: boolean;
      }) => {
        const exitCode = await installSkills(opts);
        if (exitCode !== 0) process.exitCode = exitCode;
      },
    );
}
