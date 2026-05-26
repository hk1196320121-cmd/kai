import type { McpConfig, ValidationResult } from "../types";

export interface TargetAdapter {
  readonly name: string;
  readonly skillInstallPath: string;
  configureMcp(config: McpConfig, force?: boolean): Promise<void>;
  removeMcp(): Promise<void>;
  validateInstallation(): ValidationResult;
}
