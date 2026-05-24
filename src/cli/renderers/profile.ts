import type { TraitExplanation } from "../../core/profile/provenance";
import type { ProfileSnapshot, Trait } from "../../core/profile/types";
import { bar, dim, header, kv, nextSteps, section } from "../format";
import type { ProfileDiff, TraitChange } from "../profile";

// --- Helpers ---

/**
 * Parse a JSON array string and return a comma-separated display string.
 * Returns the raw string if parsing fails.
 */
export function parseJsonField(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.join(", ");
    }
    return raw;
  } catch {
    return raw;
  }
}

/**
 * Return a confidence label with indicator symbol.
 * >= 7: high, >= 4: medium, < 4: low
 */
export function getConfidenceLabel(confidence: number): string {
  if (confidence >= 7) return "● high";
  if (confidence >= 4) return "○ medium";
  return "◌ low";
}

/**
 * Determine direction label for a trait change.
 */
function getDirectionLabel(before: number, after: number): string {
  const delta = after - before;
  if (Math.abs(delta) < 0.01) return "unchanged";
  if (delta > 0) return "increased";
  return "decreased";
}

// --- Renderers ---

/**
 * Render a full profile snapshot.
 */
export function renderProfile(snapshot: ProfileSnapshot): string {
  const lines: string[] = [];

  // Header
  lines.push(header("Kai Profile"));
  lines.push("");

  // Identity section
  if (snapshot.identity) {
    const id = snapshot.identity;
    lines.push(
      section("Identity", [
        kv("name", id.name),
        kv("role", id.role),
        kv("goals", parseJsonField(id.goals)),
        kv("expertise", parseJsonField(id.expertise_areas)),
        kv("interests", parseJsonField(id.learning_interests)),
      ]),
    );
  } else {
    lines.push(section("Identity", [dim("No identity set")]));
  }
  lines.push("");

  // Traits section
  if (snapshot.traits.length === 0) {
    lines.push(section("Traits", [dim("No traits yet")]));
  } else {
    lines.push(
      section(
        `Traits (${snapshot.traits.length})`,
        snapshot.traits.map(renderTraitBar),
      ),
    );
  }
  lines.push("");

  // Evidence section
  lines.push(
    section("Evidence", [
      kv("observations", snapshot.observationCount),
      kv("derived traits", snapshot.traits.length),
    ]),
  );
  lines.push("");

  // Next steps
  lines.push(
    nextSteps([
      "kai profile why <dimension>    Understand how a trait was derived",
      "kai profile diff --last        See how your profile has evolved",
    ]),
  );

  return lines.join("\n");
}

/**
 * Render a single trait as a bar row.
 * Format: {dimension.padEnd(22)}{bar}  {confidence}  {dim source}
 */
export function renderTraitBar(trait: Trait): string {
  const dimLabel = trait.dimension.padEnd(22);
  const barStr = bar(trait.value);
  const conf = getConfidenceLabel(trait.confidence);
  const src = dim(trait.source);
  return `${dimLabel}${barStr}  ${conf}  ${src}`;
}

/**
 * Render a profile diff.
 * Uses plain labels (increased/decreased/unchanged), NO +/- signs.
 */
export function renderDiff(diff: ProfileDiff): string {
  const lines: string[] = [];

  // Header
  const coldstartDate = diff.coldstartDate.slice(0, 10);
  lines.push(header(`Profile changes since cold start (${coldstartDate})`));
  lines.push("");

  // Changed traits
  if (diff.changed.length > 0) {
    lines.push(section("Evolved", diff.changed.map(renderChangedTrait)));
    lines.push("");
  }

  // Stable traits
  if (diff.stable.length > 0) {
    lines.push(section("Stable", diff.stable.map(renderStableTrait)));
    lines.push("");
  }

  // New traits
  if (diff.newTraits.length > 0) {
    lines.push(section("New", diff.newTraits.map(renderNewTrait)));
    lines.push("");
  }

  // Removed traits
  if (diff.removed.length > 0) {
    lines.push(section("Removed", diff.removed.map(renderRemovedTrait)));
    lines.push("");
  }

  // Summary
  lines.push(
    `${diff.stable.length} traits stable, ${diff.changed.length} evolved, ${diff.newTraits.length} new, ${diff.removed.length} removed.`,
  );

  return lines.join("\n");
}

function renderChangedTrait(c: TraitChange): string {
  const direction = getDirectionLabel(c.before.value, c.after.value);
  const confDelta = c.after.confidence - c.before.confidence;
  const confSign = confDelta > 0 ? "+" : "";
  return `${c.dimension.padEnd(22)}${c.before.value.toFixed(1)}→${c.after.value.toFixed(1)} (${direction})   confidence ${c.before.confidence}→${c.after.confidence} (${confSign}${confDelta})   — ${c.reasoning}`;
}

function renderStableTrait(c: TraitChange): string {
  return `${c.dimension.padEnd(22)}${c.before.value.toFixed(1)} (unchanged)   confidence ${c.before.confidence}   — ${c.reasoning}`;
}

function renderNewTrait(t: Trait): string {
  return `${t.dimension.padEnd(22)}${t.value.toFixed(1)} (new, confidence ${t.confidence})   — ${t.reasoning}`;
}

function renderRemovedTrait(c: TraitChange): string {
  return `${c.dimension.padEnd(22)}removed (was ${c.before.value.toFixed(1)}, confidence ${c.before.confidence})`;
}

/**
 * Render a provenance explanation for a trait.
 */
export function renderProvenance(explanation: TraitExplanation): string {
  const lines: string[] = [];

  // Header
  lines.push(header(`Why: ${explanation.dimension}`));
  lines.push("");

  // Key-value pairs
  lines.push(kv("value", explanation.traitValue.toFixed(2)));
  lines.push(kv("confidence", `${explanation.traitConfidence}/10`));
  lines.push(kv("source", explanation.traitSource));
  lines.push(kv("reasoning", explanation.traitReasoning));
  lines.push("");

  // Related observations
  if (explanation.relatedObservations.length > 0) {
    const obsLines = explanation.relatedObservations
      .slice(0, 5)
      .map((obs) => `[${obs.id}] ${obs.key} (confidence: ${obs.confidence})`);
    lines.push(
      section(
        `Related observations (${explanation.relatedObservations.length})`,
        obsLines,
      ),
    );
  }

  return lines.join("\n");
}
