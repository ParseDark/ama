import {
  asSchema,
  getToolName,
  isToolUIPart,
  type ToolSet,
  type UIMessage,
} from "ai";
import { estimateTokens } from "./memory/selector";

export type ContextPart =
  "system" | "tools" | "page" | "memory" | "conversation" | "run" | "output";
export type ContextBreakdown = Record<ContextPart, number>;
export type PromptEstimate = Pick<
  ContextBreakdown,
  "system" | "tools" | "page" | "memory" | "conversation"
>;

export const IMAGE_TOKENS = 1600;
const PROMPT_PARTS = [
  "system",
  "tools",
  "page",
  "memory",
  "conversation",
] as const;
const json = (value: unknown) =>
  value === undefined ? "" : JSON.stringify(value);

async function toolTokens(tools: ToolSet): Promise<number> {
  let total = 0;
  for (const [name, t] of Object.entries(tools)) {
    // jsonSchema may be a Promise in v7
    const schema = t.inputSchema
      ? await Promise.resolve(asSchema(t.inputSchema).jsonSchema)
      : {};
    total += estimateTokens(json({ name, description: t.description, schema }));
  }
  return total;
}

function messageTokens(message: UIMessage): number {
  let total = 0;
  for (const part of message.parts) {
    if (part.type === "text" || part.type === "reasoning")
      total += estimateTokens(part.text);
    else if (part.type === "file")
      total += part.mediaType.startsWith("image/") ? IMAGE_TOKENS : 0;
    else if (isToolUIPart(part as any)) {
      total +=
        estimateTokens(getToolName(part as any)) +
        estimateTokens(json((part as any).input));
      if ((part as any).state === "output-available")
        total += estimateTokens(json((part as any).output));
    }
  }
  return total;
}

/** Estimates the prompt by source. The page and memory text are part of the
 * instructions, so they are estimated separately and subtracted out. */
export async function estimatePrompt({
  instructions,
  pageText,
  memoryText,
  tools,
  messages,
}: {
  instructions: string;
  pageText: string;
  memoryText: string;
  tools: ToolSet;
  messages: UIMessage[];
}): Promise<PromptEstimate> {
  const page = estimateTokens(pageText),
    memory = estimateTokens(memoryText);
  return {
    system: Math.max(0, estimateTokens(instructions) - page - memory),
    tools: await toolTokens(tools),
    page,
    memory,
    conversation: messages.reduce((sum, m) => sum + messageTokens(m), 0),
  };
}

export function calibrate(
  estimate: PromptEstimate,
  {
    firstInput,
    lastInput,
    output,
  }: { firstInput: number; lastInput: number; output: number },
): ContextBreakdown {
  const estimated = PROMPT_PARTS.reduce((sum, part) => sum + estimate[part], 0),
    prompt = estimated
      ? largestRemainder(
          PROMPT_PARTS.map((part) => (estimate[part] / estimated) * firstInput),
          firstInput,
        )
      : PROMPT_PARTS.map((part) => (part === "system" ? firstInput : 0));
  return {
    ...(Object.fromEntries(
      PROMPT_PARTS.map((part, i) => [part, prompt[i]!]),
    ) as PromptEstimate),
    run: Math.max(0, lastInput - firstInput),
    output,
  };
}

/** Floors the shares, then gives leftover units to the largest remainders, so
 * the result sums to `total`. */
function largestRemainder(shares: number[], total: number): number[] {
  const floors = shares.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = shares
    .map((s, i) => [s - Math.floor(s), i] as const)
    .sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}
