import { createMemoryTools } from "./tools";
import { sensitiveDomain } from "./signals";
import type { MemorySource } from "./types";

export interface ComposerMemoryInput {
  text: string;
  category: "preference" | "reference" | "procedure";
  scope: "global" | "site";
}
/** Invoked only after the user confirms the visible preview. No LLM or MCP call. */
export async function saveComposerMemory(
  input: ComposerMemoryInput,
  context: {
    domain?: string;
    incognito?: boolean;
    source?: MemorySource;
  },
) {
  const text = input.text.trim();
  if (!text || text.length > 300)
    throw new Error("Enter between 1 and 300 characters.");
  if (input.scope === "site" && !context.domain)
    throw new Error("No current website is available. Choose global scope.");
  const tool = createMemoryTools({
    domain: context.domain,
    privateContext: !!context.incognito || sensitiveDomain(context.domain),
    source: context.source,
    userTexts: [text],
    judgeIntent: async () => true,
    searchReferences: async () => [],
  }).remember;
  // The form itself is the explicit confirmation, including storage disclosure.
  // Reuse tool execution for memory-off, category, privacy, dedupe and provenance.
  return tool.execute!(
    { ...input, text },
    { toolCallId: "composer-memory", messages: [], context: {} },
  );
}
