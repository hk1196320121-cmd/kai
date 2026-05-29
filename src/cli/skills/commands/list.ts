import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { dim, header, status } from "../../format";
import { detectPlatforms, getTarget, validateTargetName } from "../targets/registry";
import type { SkillManifest } from "../types";

export function registerListCommand(skills: Command): void {
  skills
    .command("list")
    .description("Show installed skills and their status")
    .option(
      "-t, --target <platform>",
      "Target platform (claude-code, hermes, gemini-cli) or 'all'",
    )
    .action((opts: { target?: string }) => {
      const targetNames =
        opts.target === "all"
          ? detectPlatforms()
          : opts.target
            ? (validateTargetName(opts.target), [opts.target])
            : detectPlatforms();

      if (targetNames.length === 0) {
        console.log(
          dim("No platforms detected. Use --target to specify a platform."),
        );
        return;
      }

      let foundAny = false;
      for (const name of targetNames) {
        const adapter = getTarget(name);
        const manifestPath = join(adapter.skillInstallPath, "manifest.json");

        if (!existsSync(manifestPath)) continue;

        let manifest: SkillManifest;
        try {
          manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        } catch {
          console.log(
            status(
              "error",
              `[${name}] Cannot read manifest.json. Run \`kai skills install\` to regenerate.`,
            ),
          );
          continue;
        }

        foundAny = true;
        console.log(header(`Kai Skills (${name})`));
        console.log(`Version: ${manifest.kaiVersion}`);
        console.log(`Generated: ${manifest.generatedAt}`);
        console.log();

        for (const [domain, tools] of Object.entries(manifest.skills)) {
          const toolList = Array.isArray(tools)
            ? tools.join(", ")
            : String(tools);
          console.log(`  ${status("success", domain)} — ${toolList}`);
        }
      }

      if (!foundAny) {
        console.log(
          dim("No skills installed. Run `kai skills install` first."),
        );
      }
    });
}
