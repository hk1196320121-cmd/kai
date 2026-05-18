#!/usr/bin/env bun
import { Command } from "commander";
import { registerProfileCommands } from "./profile";
import { registerObserveCommands } from "./observe";
import { registerMcpCommands } from "./mcp";

const program = new Command();

program
  .name("kai")
  .description("Kai — Intelligent task orchestration and personal assistant")
  .version("0.1.0");

registerProfileCommands(program);
registerObserveCommands(program);
registerMcpCommands(program);

export { program };

// Run if called directly
if (import.meta.main) {
  program.parse();
}
