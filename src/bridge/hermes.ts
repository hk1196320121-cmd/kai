import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HermesCronJob, HermesSkill } from "../core/profile/types";

export interface CronOutputEntry {
  jobId: string;
  filename: string;
  content: string;
}

export class HermesBridge {
  private hermesDir: string;

  constructor(hermesDir?: string) {
    this.hermesDir = hermesDir ?? join(homedir(), ".hermes");
  }

  listCronJobs(): HermesCronJob[] {
    const jobsPath = join(this.hermesDir, "cron", "jobs.json");
    if (!existsSync(jobsPath)) return [];
    try {
      const raw = readFileSync(jobsPath, "utf-8");
      return JSON.parse(raw) as HermesCronJob[];
    } catch {
      return [];
    }
  }

  getCronOutput(jobId: string): CronOutputEntry[] {
    const outputDir = join(this.hermesDir, "cron", "output", jobId);
    if (!existsSync(outputDir)) return [];
    try {
      const files = readdirSync(outputDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();
      return files.map((f) => ({
        jobId,
        filename: f,
        content: readFileSync(join(outputDir, f), "utf-8"),
      }));
    } catch {
      return [];
    }
  }

  getAllCronOutputs(): CronOutputEntry[] {
    const outputBase = join(this.hermesDir, "cron", "output");
    if (!existsSync(outputBase)) return [];
    try {
      const jobDirs = readdirSync(outputBase).filter((name) => {
        const full = join(outputBase, name);
        return statSync(full).isDirectory();
      });
      const all: CronOutputEntry[] = [];
      for (const jobId of jobDirs) {
        all.push(...this.getCronOutput(jobId));
      }
      return all;
    } catch {
      return [];
    }
  }

  listSkills(): HermesSkill[] {
    const skillsDir = join(this.hermesDir, "skills");
    if (!existsSync(skillsDir)) return [];
    try {
      const dirs = readdirSync(skillsDir).filter((name) => {
        const full = join(skillsDir, name);
        return statSync(full).isDirectory();
      });
      const skills: HermesSkill[] = [];
      for (const dirName of dirs) {
        const skillMd = join(skillsDir, dirName, "SKILL.md");
        if (existsSync(skillMd)) {
          const content = readFileSync(skillMd, "utf-8");
          skills.push({
            name: dirName,
            description:
              content
                .split("\n")
                .find((l) => l.trim() && !l.startsWith("---"))
                ?.trim() ?? "",
            path: skillMd,
          });
        }
      }
      return skills;
    } catch {
      return [];
    }
  }
}
