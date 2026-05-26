import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { dim, header, status } from "../../format";
import { ClaudeCodeTarget } from "../targets/claude-code";
import type { SkillManifest } from "../types";

export function registerListCommand(skills: Command): void {
  skills
    .command("list")
    .description("Show installed skills and their status")
    .action(() => {
      const target = new ClaudeCodeTarget();
      const manifestPath = join(target.skillInstallPath, "manifest.json");

      if (!existsSync(manifestPath)) {
        console.log(
          dim("No skills installed. Run `kai skills install` first."),
        );
        return;
      }

      let manifest: SkillManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      } catch {
        console.log(
          status(
            "error",
            "Cannot read manifest.json. Run `kai skills install` to regenerate.",
          ),
        );
        return;
      }

      console.log(header("Kai Skills"));
      console.log(`Version: ${manifest.kaiVersion}`);
      console.log(`Generated: ${manifest.generatedAt}`);
      console.log();

      for (const [domain, tools] of Object.entries(manifest.skills)) {
        const toolList = Array.isArray(tools)
          ? tools.join(", ")
          : String(tools);
        console.log(`  ${status("success", domain)} — ${toolList}`);
      }
    });
}
