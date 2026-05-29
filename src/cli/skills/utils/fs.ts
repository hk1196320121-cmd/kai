import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { stringify as yamlStringify } from "yaml";

export function atomicWriteJson(filePath: string, data: unknown): void {
  const resolved = existsSync(filePath) ? realpathSync(filePath) : filePath;
  const dir = dirname(resolved);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.kai-skills-${randomUUID()}.tmp`);
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, resolved);
  } catch {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      /* best effort */
    }
    throw new Error(`Failed to write ${filePath}`);
  }
}

export function atomicWriteYaml(filePath: string, data: unknown): void {
  const resolved = existsSync(filePath) ? realpathSync(filePath) : filePath;
  const dir = dirname(resolved);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.kai-skills-${randomUUID()}.tmp`);
  try {
    writeFileSync(tmpPath, yamlStringify(data, { lineWidth: -1 }));
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, resolved);
  } catch {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      /* best effort */
    }
    throw new Error(`Failed to write ${filePath}`);
  }
}
