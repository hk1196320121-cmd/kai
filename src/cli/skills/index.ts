import type { Command } from "commander";
import { registerDoctorCommand } from "./commands/doctor";
import { registerInstallCommand } from "./commands/install";
import { registerListCommand } from "./commands/list";
import { registerUninstallCommand } from "./commands/uninstall";

export function registerSkillsCommands(program: Command): void {
  const skills = program
    .command("skills")
    .description("Manage Kai skill files for AI agent shells");

  registerInstallCommand(skills);
  registerListCommand(skills);
  registerDoctorCommand(skills);
  registerUninstallCommand(skills);
}
