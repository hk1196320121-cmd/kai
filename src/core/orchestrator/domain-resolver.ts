import type { IdeaDomain } from "./types";

const DOMAIN_MAP: Record<string, IdeaDomain> = {
  engineering: "coding",
  design: "creative",
  management: "management",
  research: "research",
  writing: "writing",
  other: "general",
};

export function resolveIdeaDomain(raw: string): IdeaDomain {
  return DOMAIN_MAP[raw] ?? "general";
}
