#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { setNoColor } from "./format";
import { registerMcpCommands } from "./mcp";
import { registerObserveCommands } from "./observe";
import { registerProfileCommands } from "./profile";
import { registerPromptCommands } from "./prompt";
import { registerSkillsCommands } from "./skills";
import { registerTelemetryCommands } from "./telemetry";
import { registerWorkCommands } from "./work";

const pkg = (() => {
  try {
    return JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
    );
  } catch {
    return { version: "0.0.0", description: "Kai" };
  }
})();

const program = new Command();

program
  .name("kai")
  .description(pkg.description)
  .version(pkg.version)
  .option("--no-color", "Disable colored output");

// Commander negated options: --no-color stores opts.color === false
program.hook("preAction", () => {
  const opts = program.opts();
  if (opts.color === false) {
    setNoColor(true);
  }
});

registerProfileCommands(program);
registerObserveCommands(program);
registerMcpCommands(program);
registerWorkCommands(program);
registerPromptCommands(program);
registerTelemetryCommands(program);
registerSkillsCommands(program);

export { program };

// Run if called directly
if (import.meta.main) {
  program.parse();
}
