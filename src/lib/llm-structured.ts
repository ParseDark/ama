import { generateText, tool, type LanguageModel } from "ai";
import type { z } from "zod";

/** Name of the tool the model is made to call; its arguments are the answer. */
export const STRUCTURED_TOOL = "answer";

export class StructuredOutputError extends Error {
  override name = "StructuredOutputError";
}

/**
 * Asks for a JSON answer by forcing a call to a tool whose input schema is
 * `schema`. Response-format JSON doesn't work through every gateway: some
 * gateways ignore both json_object and json_schema, and the model answers
 * fenced JSON with invented field names. Tool arguments follow the schema
 * reliably everywhere tools work.
 *
 * Throws StructuredOutputError when the reply has no valid call (a bad answer,
 * not an outage).
 */
export async function generateStructured<T>({
  model,
  instructions,
  prompt,
  schema,
  abortSignal,
}: {
  model: LanguageModel;
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  abortSignal?: AbortSignal;
}): Promise<T> {
  let result;
  try {
    result = await generateText({
      model,
      instructions,
      prompt,
      tools: {
        [STRUCTURED_TOOL]: tool({
          description: "Give your answer.",
          inputSchema: schema,
        }),
      },
      toolChoice: { type: "tool", toolName: STRUCTURED_TOOL },
      maxRetries: 0,
      ...(abortSignal ? { abortSignal } : {}),
    });
  } catch (error) {
    // The model answered but ignored the tool or sent unusable arguments: a
    // bad answer, not an outage.
    if (
      error instanceof Error &&
      /ToolChoiceViolation|InvalidToolInput|NoSuchTool/.test(error.name)
    )
      throw new StructuredOutputError(error.message);
    throw error;
  }
  const call = result.toolCalls.find((c) => c.toolName === STRUCTURED_TOOL);
  const parsed =
    call && !call.invalid ? schema.safeParse(call.input) : undefined;
  if (!parsed?.success)
    throw new StructuredOutputError(
      `The model's answer didn't match the expected format${call?.invalid ? " (invalid tool input)" : ""}.`,
    );
  return parsed.data;
}
