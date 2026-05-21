import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerTelemetryCommands } from "../src/cli/telemetry";

describe("Telemetry CLI", () => {
  test("registers telemetry subcommands", () => {
    const program = new Command();
    registerTelemetryCommands(program);
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("telemetry");
    const telCmd = program.commands.find((c) => c.name() === "telemetry");
    const subCommands = telCmd?.commands.map((c) => c.name()) ?? [];
    expect(subCommands).toContain("health");
    expect(subCommands).toContain("query");
    expect(subCommands).toContain("trace");
    expect(subCommands).toContain("errors");
    expect(subCommands).toContain("explain");
  });
});
