import { MIGRATION_V1 } from "./v1";
import { MIGRATION_V2 } from "./v2";
import { MIGRATION_V3 } from "./v3";
import { MIGRATION_V4 } from "./v4";
import { MIGRATION_V5 } from "./v5";
import { MIGRATION_V6 } from "./v6";
import { MIGRATION_V7 } from "./v7";
import { MIGRATION_V8 } from "./v8";

export interface Migration {
  version: number;
  sql: string;
  /** If true, the migration SQL self-bumps schema_version (skip code-level bump). */
  selfBumps?: boolean;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, sql: MIGRATION_V1 },
  { version: 2, sql: MIGRATION_V2 },
  { version: 3, sql: MIGRATION_V3 },
  { version: 4, sql: MIGRATION_V4 },
  { version: 5, sql: MIGRATION_V5 },
  { version: 6, sql: MIGRATION_V6 },
  { version: 7, sql: MIGRATION_V7 },
  { version: 8, sql: MIGRATION_V8, selfBumps: true },
];

// E2: Runtime ordering assertion — versions must be sequential 1..N
for (let i = 0; i < MIGRATIONS.length; i++) {
  if (MIGRATIONS[i].version !== i + 1) {
    throw new Error(
      `Migration ordering violation: expected version ${i + 1} at index ${i}, got ${MIGRATIONS[i].version}`,
    );
  }
}
