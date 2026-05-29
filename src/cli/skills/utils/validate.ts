import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidationResult } from "../types";

export function validateSkillManifest(
  skillInstallPath: string,
  targetName: string,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const manifestPath = join(skillInstallPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    errors.push(`No manifest.json found. Run \`kai skills install --target ${targetName}\` first.`);
    return { valid: false, errors, warnings };
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (!manifest.kaiVersion) {
      errors.push("Manifest missing kaiVersion field.");
    }
    if (!manifest.skills || Object.keys(manifest.skills).length === 0) {
      warnings.push("Manifest has no skills registered.");
    }
  } catch {
    errors.push("Manifest file contains invalid JSON.");
  }

  return { valid: errors.length === 0, errors, warnings };
}
