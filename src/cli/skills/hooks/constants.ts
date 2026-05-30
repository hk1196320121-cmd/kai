/**
 * Shared constants for generated hook scripts.
 * Single source of truth — injected via template literals so all
 * three hooks (auto-observe, session-start, stop) stay in sync.
 */

/** Minimum DB schema version required for autopilot hooks. */
export const MIN_SCHEMA_VERSION = 9;

/** Tool names that auto-observe is allowed to capture. */
export const ALLOWED_TOOLS = [
  // Code tools
  "Edit",
  "Write",
  "Read",
  "MultiEdit",
  // Shell tools
  "Bash",
  // Search tools
  "Grep",
  "Glob",
  "WebSearch",
  "WebFetch",
  // Planning tools
  "TodoRead",
  "TodoWrite",
] as const;

/** SQLite busy timeout for hook DB access (ms). */
export const BUSY_TIMEOUT_MS = 5000;
