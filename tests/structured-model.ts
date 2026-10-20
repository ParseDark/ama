import { MockLanguageModelV4 } from "ai/test";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/**
 * A judge model that answers with the forced `answer` tool call. `input` is
 * passed through as the tool arguments; strings are left raw so tests can make
 * the answer malformed.
 */
export function structuredModel(input: unknown) {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "c1",
          toolName: "answer",
          input: typeof input === "string" ? input : JSON.stringify(input),
        },
      ],
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage,
      warnings: [],
    }),
  });
  return { model, doGenerate: model.doGenerateCalls };
}
