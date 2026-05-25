import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AddObservationInput } from "../../core/profile/engine";
import { renderError } from "../format";

// Git scan thresholds
const MIN_GIT_COMMITS = 5;
const MORNING_HOUR_START = 5;
const MORNING_HOUR_END = 8;
const MORNING_RATIO_THRESHOLD = 0.3;
const DETAIL_LEVEL_HIGH_CHARS = 50;
const DETAIL_LEVEL_MED_CHARS = 20;

export interface GitScanResult {
  observations: AddObservationInput[];
  traits: { dimension: string; hints: string[] }[];
}

function makeProvenance(signalType?: string): string {
  return JSON.stringify({
    origin: "kai work start",
    extracted_at: new Date().toISOString(),
    extractor_version: "1.0.0",
    ...(signalType ? { signal_type: signalType } : {}),
  });
}

export function scanGitHistory(repoPath: string): GitScanResult {
  const observations: AddObservationInput[] = [];
  const traits: { dimension: string; hints: string[] }[] = [];

  const gitDir = join(repoPath, ".git");
  if (!existsSync(gitDir)) return { observations, traits };

  let logOutput: string;
  try {
    logOutput = execSync(
      'git log --oneline --since="30.days ago" --format="%H%x00%aI%x00%s"',
      { cwd: repoPath, encoding: "utf-8", timeout: 5000 },
    ).trim();
  } catch (err) {
    console.error(renderError(err as Error));
    return { observations, traits };
  }

  if (!logOutput) return { observations, traits };

  const lines = logOutput.split("\n");
  if (lines.length < MIN_GIT_COMMITS) return { observations, traits };

  // Commit time distribution -> early_riser / night_owl
  const hours: number[] = [];
  for (const line of lines) {
    const parts = line.split("\0");
    if (parts.length >= 2) {
      const match = parts[1].match(/T(\d{2}):/);
      if (match) hours.push(Number.parseInt(match[1], 10));
    }
  }

  if (hours.length > 0) {
    const morningCount = hours.filter(
      (h) => h >= MORNING_HOUR_START && h <= MORNING_HOUR_END,
    ).length;
    const morningRatio = morningCount / hours.length;

    observations.push({
      type: "signal",
      key: "coldstart:git.commit_time_distribution",
      value: JSON.stringify({
        morning_ratio: morningRatio,
        total_commits: hours.length,
      }),
      confidence: 4,
      source: "coldstart",
      provenance: makeProvenance("commit_time"),
    });

    if (morningRatio > MORNING_RATIO_THRESHOLD) {
      traits.push({
        dimension: "early_riser",
        hints: [`${Math.round(morningRatio * 100)}% morning commits`],
      });
    }
  }

  // Commit message avg length -> detail_oriented
  const msgLengths = lines.map((l) => {
    const parts = l.split("\0");
    return (parts[2] ?? "").length;
  });
  const avgLen = msgLengths.reduce((a, b) => a + b, 0) / msgLengths.length;

  observations.push({
    type: "signal",
    key: "coldstart:git.commit_message_length",
    value: JSON.stringify({
      avg_length: Math.round(avgLen),
      total_commits: lines.length,
      detail_level:
        avgLen > DETAIL_LEVEL_HIGH_CHARS
          ? "high"
          : avgLen > DETAIL_LEVEL_MED_CHARS
            ? "medium"
            : "low",
    }),
    confidence: 4,
    source: "coldstart",
    provenance: makeProvenance("commit_length"),
  });

  if (avgLen > DETAIL_LEVEL_HIGH_CHARS) {
    traits.push({
      dimension: "detail_oriented",
      hints: [`avg commit message ${Math.round(avgLen)} chars`],
    });
  }

  // Branch naming patterns -> scope_appetite
  let currentBranch = "";
  try {
    currentBranch = execSync("git branch --show-current", {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  } catch {
    // detached HEAD, shallow clone, etc. — expected, not an error
  }

  if (currentBranch) {
    const hasStructuredPrefix = /^(feat|fix|chore|docs|refactor)\//.test(
      currentBranch,
    );
    observations.push({
      type: "signal",
      key: "coldstart:git.branch_pattern",
      value: JSON.stringify({
        branch: currentBranch,
        structured: hasStructuredPrefix,
      }),
      confidence: 5,
      source: "coldstart",
      provenance: makeProvenance("branch_pattern"),
    });

    if (hasStructuredPrefix) {
      traits.push({
        dimension: "scope_appetite",
        hints: [`structured branch naming (${currentBranch.split("/")[0]}/*)`],
      });
    }
  }

  return { observations, traits };
}
