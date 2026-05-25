import type { DerivedTrait } from "../../core/profile/derivator";
import { bar } from "../format";

function shouldShowProgress(): boolean {
  return !process.argv.includes("--json") && !!process.stderr.isTTY;
}

export function progress(message: string): void {
  if (!shouldShowProgress()) return;
  process.stderr.write(`\r\x1b[2K  ${message}...`);
}

export function progressDone(message: string): void {
  if (!shouldShowProgress()) return;
  process.stderr.write(`\r\x1b[2K  ${message}\n`);
}

export function displayPreview(
  traits: DerivedTrait[],
  gitHints: { dimension: string; hints: string[] }[],
): void {
  console.log(
    `\n✓ Profile draft generated (${traits.length} traits detected):\n`,
  );

  const hintMap = new Map<string, string[]>();
  for (const h of gitHints) {
    const existing = hintMap.get(h.dimension) ?? [];
    hintMap.set(h.dimension, [...existing, ...h.hints]);
  }

  for (const t of traits) {
    const barStr = bar(t.value);
    const hints = hintMap.get(t.dimension);
    const hintStr = hints ? ` + ${hints.join(", ")}` : "";
    const reasoning =
      t.reasoning.length > 60 ? `${t.reasoning.slice(0, 57)}...` : t.reasoning;
    console.log(
      `  ${t.dimension.padEnd(22)}${barStr}  ${t.confidence}/10  — ${reasoning}${hintStr}`,
    );
  }

  console.log("\nLooks right? [Y]es / [E]dit trait / [R]estart");
}
