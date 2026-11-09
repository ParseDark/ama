import type { ToolSet } from "ai";

export interface ComposerTool {
  name: string;
  description: string;
  group: string;
}
export interface ComposerToolCatalog {
  tools: ComposerTool[];
  errors: string[];
}
/** A selection is a request, not tool arguments or an approval. */
export function requestedComposerTool(text: string) {
  const match = /^\s*@tool:([a-zA-Z0-9_-]{1,64})(?:\s+([\s\S]*))?$/.exec(text);
  return match ? { name: match[1], argument: (match[2] ?? "").trim() } : null;
}
export function describeComposerTools(
  tools: ToolSet,
  group: string,
): ComposerTool[] {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: (typeof tool.description === "string"
      ? tool.description
      : ""
    ).slice(0, 500),
    group,
  }));
}
