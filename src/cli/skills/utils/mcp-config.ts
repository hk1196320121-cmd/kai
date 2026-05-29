import { existsSync, readFileSync, realpathSync } from "node:fs";
import { parse as yamlParse } from "yaml";
import type { McpConfig, ValidationResult } from "../types";
import { atomicWriteJson, atomicWriteYaml } from "./fs";

type ConfigFormat = "json" | "yaml";

interface McpConfigOpts {
  configPath: string;
  mcpServersKey: string;
  format: ConfigFormat;
}

function readConfig(
  configPath: string,
  format: ConfigFormat,
): Record<string, unknown> | null {
  if (!existsSync(configPath)) return null;
  const resolved = realpathSync(configPath);
  const raw = readFileSync(resolved, "utf-8");
  if (format === "yaml") {
    return (yamlParse(raw) as Record<string, unknown>) ?? null;
  }
  return JSON.parse(raw);
}

function writeConfig(
  configPath: string,
  data: unknown,
  format: ConfigFormat,
): void {
  if (format === "yaml") {
    atomicWriteYaml(configPath, data);
  } else {
    atomicWriteJson(configPath, data);
  }
}

export function validateMcpInConfig(opts: McpConfigOpts): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(opts.configPath)) {
    warnings.push(
      `No config file found at ${opts.configPath}. Run with --configure-mcp to register.`,
    );
    return { valid: true, errors, warnings };
  }

  try {
    const config = readConfig(opts.configPath, opts.format);
    const servers = config?.[opts.mcpServersKey] as
      | Record<string, unknown>
      | undefined;
    if (!servers?.kai) {
      errors.push(
        `No "kai" MCP server registered in ${opts.configPath}. Run with --configure-mcp.`,
      );
    }
  } catch {
    errors.push(`Cannot parse ${opts.configPath} for MCP validation.`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export async function configureMcpInConfig(
  config: McpConfig,
  opts: McpConfigOpts,
  force = false,
): Promise<void> {
  let existing: Record<string, unknown>;

  if (existsSync(opts.configPath)) {
    try {
      existing = readConfig(opts.configPath, opts.format) ?? {};
    } catch {
      throw new Error(
        `Cannot read ${opts.configPath}. Check the file contains valid ${opts.format.toUpperCase()}.`,
      );
    }
  } else {
    existing = {};
  }

  const existingValue = existing[opts.mcpServersKey];
  if (existingValue !== undefined && existingValue !== null) {
    if (Array.isArray(existingValue) || typeof existingValue !== "object") {
      throw new Error(
        `Cannot configure MCP: "${opts.mcpServersKey}" in ${opts.configPath} is ${Array.isArray(existingValue) ? "an array" : typeof existingValue}, expected an object. Fix manually or use --force to overwrite.`,
      );
    }
  } else {
    existing[opts.mcpServersKey] = {};
  }

  const servers = existing[opts.mcpServersKey] as Record<string, unknown>;
  if (servers.kai && !force) {
    const existingEntry = servers.kai as Record<string, unknown>;
    if (
      existingEntry.command !== config.command ||
      JSON.stringify(existingEntry.args) !== JSON.stringify(config.args)
    ) {
      throw new Error(
        `Conflicting MCP entry for "kai" in ${opts.configPath}. Use --force to overwrite, or edit manually.`,
      );
    }
    return;
  }

  servers.kai = config;
  writeConfig(opts.configPath, existing, opts.format);
}

export async function removeMcpFromConfig(opts: McpConfigOpts): Promise<void> {
  if (!existsSync(opts.configPath)) return;

  let existing: Record<string, unknown>;
  try {
    existing = readConfig(opts.configPath, opts.format) ?? {};
  } catch {
    return;
  }

  if (
    typeof existing?.[opts.mcpServersKey] === "object" &&
    existing[opts.mcpServersKey] !== null &&
    (existing[opts.mcpServersKey] as Record<string, unknown>).kai
  ) {
    delete (existing[opts.mcpServersKey] as Record<string, unknown>).kai;
    writeConfig(opts.configPath, existing, opts.format);
  }
}
