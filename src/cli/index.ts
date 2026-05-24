#!/usr/bin/env bun
import { Command } from "commander";
import { registerMcpCommands } from "./mcp";
import { registerObserveCommands } from "./observe";
import { registerProfileCommands } from "./profile";
import { registerPromptCommands } from "./prompt";
import { registerTelemetryCommands } from "./telemetry";
import { registerWorkCommands } from "./work";

const program = new Command();

program
  .name("kai")
  .description("Kai — Intelligent task orchestration and personal assistant")
  .version("0.1.0")
  .option("--no-color", "Disable colored output");

registerProfileCommands(program);
registerObserveCommands(program);
registerMcpCommands(program);
registerWorkCommands(program);
registerPromptCommands(program);
registerTelemetryCommands(program);

export { program };

// Run if called directly
if (import.meta.main) {
  program.parse();
}
