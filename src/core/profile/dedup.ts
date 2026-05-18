import { ProfileEngine } from "./engine";
import { createHash } from "crypto";

export interface DedupResult {
  isDuplicate: boolean;
  hash: string;
}

export interface DedupExtras {
  tags?: string[];
  context?: string;
}

export function checkDuplicate(
  engine: ProfileEngine,
  namespace: string,
  content: string,
  extras?: DedupExtras,
): DedupResult {
  let hashInput = content;
  if (extras?.tags?.length) hashInput += JSON.stringify(extras.tags);
  if (extras?.context) hashInput += extras.context;

  const hash = createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
  const key = `${namespace}:${hash}`;
  const existing = engine.getObservations({ key });
  return { isDuplicate: existing.length > 0, hash };
}
