import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let counter = 0;

export function tempDb(prefix = "kai-test"): string {
  return join(
    tmpdir(),
    `${prefix}-${Date.now()}-${counter++}-${Math.random().toString(36).slice(2)}.db`,
  );
}

export function cleanup(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}
