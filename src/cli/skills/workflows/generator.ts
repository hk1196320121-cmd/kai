import { mcpToolName } from "../templates";
import type { WorkflowDefinition } from "./types";

export class CommandGenerator {
  private readonly bakedTraits: Map<string, number>;

  constructor(bakedTraits: Map<string, number>) {
    this.bakedTraits = bakedTraits;
  }

  generateCommand(wf: WorkflowDefinition): string {
    const hasProfile = this.bakedTraits.size > 0;
    const toolCalls = wf.tools
      .map((t) => {
        const mcpName = `mcp__kai__${mcpToolName(t.id)}`;
        const params = t.params
          ? Object.entries(t.params)
              .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : v}`)
              .join(", ")
          : "";
        return `Call ${mcpName}${params ? ` with ${params}` : ""}.`;
      })
      .join("\n");

    const conditionalSections = hasProfile
      ? wf.profileConditions
          .filter((c) => {
            const value = this.bakedTraits.get(c.trait);
            return value !== undefined && value >= c.threshold;
          })
          .map((c) => c.include)
          .join("\n\n")
      : "";

    const fallbackSection =
      !hasProfile && wf.emptyProfileFallback ? wf.emptyProfileFallback : "";

    const parts: string[] = [
      `# /${wf.name}`,
      "",
      wf.description,
      "",
      "## Instructions",
      "",
      toolCalls,
    ];

    if (conditionalSections) {
      parts.push("", conditionalSections);
    }

    if (fallbackSection) {
      parts.push("", fallbackSection);
    }

    parts.push("", "Display the results in a clear, organized format.");

    return parts.join("\n");
  }

  generateAll(
    workflows: WorkflowDefinition[],
  ): { name: string; content: string }[] {
    return workflows.map((wf) => ({
      name: wf.name,
      content: this.generateCommand(wf),
    }));
  }
}
