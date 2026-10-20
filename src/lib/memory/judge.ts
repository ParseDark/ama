import type { LanguageModel } from "ai";
import type { z } from "zod";
import { generateStructured } from "../llm-structured";
export type Models = Array<LanguageModel | (() => Promise<LanguageModel>)>;
export const malformed = (e: unknown) =>
  /StructuredOutput|NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse/.test(
    (e as Error)?.name ?? "",
  );
/**
 * Runs a small structured judge. `stopOnMalformed` is for judges where a bad
 * answer is terminal (the intent check); others may try the next model.
 */
export async function judge<T>(
  models: Models,
  instructions: string,
  prompt: string,
  schema: z.ZodType<T>,
  { stopOnMalformed = false }: { stopOnMalformed?: boolean } = {},
): Promise<T | null> {
  for (const entry of models) {
    try {
      const model = typeof entry === "function" ? await entry() : entry;
      return await generateStructured({
        model,
        instructions,
        prompt,
        schema,
        abortSignal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      if (stopOnMalformed && malformed(e)) return null;
    }
  }
  return null;
}
