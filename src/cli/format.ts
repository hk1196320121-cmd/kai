// --- Color policy ---

let noColorOverride = false;

export function setNoColor(value: boolean): void {
  noColorOverride = value;
}

export function shouldUseColor(): boolean {
  if (noColorOverride) return false;
  if (process.env.NO_COLOR !== undefined) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

// --- Terminal width ---

export function getTerminalWidth(): number {
  const cols = process.stdout.columns;
  if (cols === undefined || cols === null) return 80;
  if (cols < 40) return 40;
  return cols;
}

// --- Color-aware wrappers ---
// We cannot rely on picocolors for runtime color toggling because it caches
// isColorSupported at import time. Instead, we build ANSI strings directly
// and gate them through shouldUseColor().

function bold(text: string): string {
  return shouldUseColor() ? `\x1b[1m${text}\x1b[22m` : text;
}

function dimColor(text: string): string {
  return shouldUseColor() ? `\x1b[2m${text}\x1b[22m` : text;
}

function green(text: string): string {
  return shouldUseColor() ? `\x1b[32m${text}\x1b[39m` : text;
}

function yellow(text: string): string {
  return shouldUseColor() ? `\x1b[33m${text}\x1b[39m` : text;
}

function red(text: string): string {
  return shouldUseColor() ? `\x1b[31m${text}\x1b[39m` : text;
}

function cyan(text: string): string {
  return shouldUseColor() ? `\x1b[36m${text}\x1b[39m` : text;
}

// --- ANSI-aware string helpers ---

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visibleLen(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

function ansiPadEnd(s: string, targetVisible: number): string {
  const current = visibleLen(s);
  const pad = targetVisible - current;
  return pad > 0 ? s + " ".repeat(pad) : s;
}

// --- Primitives ---

export function header(text: string): string {
  return bold(text);
}

export function subheader(text: string): string {
  return dimColor(text);
}

export function kv(label: string, value: unknown): string {
  const displayValue =
    value === undefined || value === null ? "—" : String(value);
  const labelWidth = Math.max(label.length + 2, 14);
  const padded = label.padEnd(labelWidth);
  return `${bold(padded)}${displayValue}`;
}

export interface BarOpts {
  width?: number;
  max?: number;
}

export function bar(value: number, opts: BarOpts = {}): string {
  const width = Math.max(1, opts.width ?? 10);
  const max = opts.max ?? 1.0;

  if (max <= 0) return "░".repeat(width) + "  0.00";

  // Clamp: handle NaN (→ 0), +Infinity (→ max), -Infinity (→ 0), negative (→ 0), > max (→ max)
  let safeValue: number;
  if (!Number.isFinite(value)) {
    safeValue = Number.isNaN(value) || value < 0 ? 0 : max;
  } else {
    safeValue = Math.max(0, Math.min(value, max));
  }
  const ratio = safeValue / max;

  const filled = Math.floor(ratio * width);
  const empty = width - filled;
  const barStr = "█".repeat(filled) + "░".repeat(empty);

  const displayValue = ratio.toFixed(2);

  // Color thresholds based on ratio
  if (shouldUseColor()) {
    if (ratio >= 0.7) return green(`${barStr}  ${displayValue}`);
    if (ratio >= 0.4) return yellow(`${barStr}  ${displayValue}`);
    return red(`${barStr}  ${displayValue}`);
  }

  return `${barStr}  ${displayValue}`;
}

export function section(title: string, rows: string[]): string {
  const lines = [bold(title)];
  if (rows.length === 0) {
    lines.push(dimColor("  No data"));
  } else {
    for (const row of rows) {
      lines.push(`  ${row}`);
    }
  }
  return lines.join("\n");
}

export function status(
  type: "success" | "warning" | "error" | "info",
  text: string,
): string {
  switch (type) {
    case "success":
      return `${green("✓")} ${text}`;
    case "error":
      return `${red("✗")} ${text}`;
    case "warning":
      return `${yellow("!")} ${text}`;
    case "info":
      return `${cyan("→")} ${text}`;
  }
}

export function table(columns: string[], rows: string[][]): string {
  const colWidths = columns.map((col, i) => {
    const headerLen = visibleLen(col);
    const maxRowLen = Math.max(0, ...rows.map((r) => visibleLen(r[i] ?? "")));
    return Math.max(headerLen, maxRowLen);
  });

  const headerLine = columns
    .map((col, i) => ansiPadEnd(col, colWidths[i]))
    .join("  ");
  const lines = [bold(headerLine)];

  for (const row of rows) {
    const rowLine = row
      .map((cell, i) => ansiPadEnd(cell ?? "", colWidths[i]))
      .join("  ");
    lines.push(rowLine);
  }

  return lines.join("\n");
}

export function list(items: string[]): string {
  if (items.length === 0) return "";
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

export function dim(text: string): string {
  return dimColor(text);
}

export function emphasis(text: string): string {
  return bold(text);
}

export function renderError(error: Error | string, recovery?: string): string {
  const message = error instanceof Error ? error.message : error;
  const lines = [red(`Error: ${message}`)];
  if (recovery) {
    lines.push(dimColor(`  → ${recovery}`));
  }
  return lines.join("\n");
}

export function divider(): string {
  const width = Math.min(getTerminalWidth(), 60);
  return "─".repeat(width);
}

export function nextSteps(steps: string[]): string {
  if (steps.length === 0) return "";
  const lines = [bold("Next")];
  for (const step of steps) {
    lines.push(`  ${step}`);
  }
  return lines.join("\n");
}
