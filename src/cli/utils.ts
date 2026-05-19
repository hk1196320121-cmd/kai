import { homedir } from "node:os";
import { join } from "node:path";
import { ProfileEngine } from "../core/profile/engine";
import { KaiDB } from "../db/client";

export function getDbPath(): string {
  return process.env.KAI_DB ?? join(homedir(), ".kai", "kai.db");
}

export function getEngine(): { db: KaiDB; engine: ProfileEngine } {
  const db = new KaiDB(getDbPath());
  const engine = new ProfileEngine(db);
  return { db, engine };
}

export function getHermesDir(): string {
  return process.env.HERMES_HOME ?? join(homedir(), ".hermes");
}
