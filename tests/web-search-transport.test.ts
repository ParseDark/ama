import { expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { LocalChatTransport } from "@/lib/local-chat-transport";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
it("executes search then fetch with a non-DeepSeek model and emits persisted source receipts", async () => {
  let step = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          if (step < 2)
            c.enqueue({
              type: "tool-call",
              toolCallId: `w${step}`,
              toolName: step === 0 ? "web_search" : "web_fetch",
              input: JSON.stringify(
                step === 0
                  ? { query: "DeepSeek docs", count: 5 }
                  : { url: "https://api-docs.deepseek.com/guides/search" },
              ),
            });
          else {
            c.enqueue({ type: "text-start", id: "t" });
            c.enqueue({
              type: "text-delta",
              id: "t",
              delta: "[Docs](https://api-docs.deepseek.com/guides/search)",
            });
            c.enqueue({ type: "text-end", id: "t" });
          }
          c.enqueue({
            type: "finish",
            finishReason: {
              unified: step++ < 2 ? "tool-calls" : "stop",
              raw: "stop",
            },
            usage,
          });
          c.close();
        },
      }),
    }),
  });
  const webFetch = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/search")
      ? Response.json({
          results: [
            {
              title: "Docs",
              url: "https://api-docs.deepseek.com/guides/search",
              snippet: "display",
              summary: "model summary",
            },
          ],
        })
      : Response.json({ title: "Docs", content: "# Verified public content" }),
  );
  const transport = new LocalChatTransport({
    loadSettings: async () => ({
      ...DEFAULT_SETTINGS,
      webSearch: {
        enabled: true,
        provider: "deepseek",
        apiKey: "never-in-model-prompt",
      },
    }),
    readActivePage: async () => null,
    createModel: async () => model as any,
    webFetch,
  });
  const stream = await transport.sendMessages({
    chatId: "web",
    abortSignal: undefined,
    messageId: undefined,
    trigger: "submit-message",
    messages: [
      {
        id: "u",
        role: "user",
        parts: [{ type: "text", text: "Find public docs" }],
      },
    ],
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(step).toBe(3);
  expect(webFetch).toHaveBeenCalledTimes(2);
  expect(chunks).toContainEqual(
    expect.objectContaining({
      type: "tool-output-available",
      toolCallId: "w0",
      output: expect.objectContaining({
        results: [expect.objectContaining({ title: "Docs" })],
      }),
    }),
  );
  expect(chunks).toContainEqual(
    expect.objectContaining({
      type: "tool-output-available",
      toolCallId: "w1",
      output: expect.objectContaining({ content: "# Verified public content" }),
    }),
  );
  expect(JSON.stringify(model.doStreamCalls)).not.toContain(
    "never-in-model-prompt",
  );
  expect(JSON.stringify(model.doStreamCalls[2].prompt)).toContain(
    "Verified public content",
  );
});

it("does not advertise unavailable web tools to the model", async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          c.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
          });
          c.close();
        },
      }),
    }),
  });
  const transport = new LocalChatTransport({
    loadSettings: async () => DEFAULT_SETTINGS,
    readActivePage: async () => null,
    createModel: async () => model as any,
  });
  const stream = await transport.sendMessages({
    chatId: "off",
    abortSignal: undefined,
    messageId: undefined,
    trigger: "submit-message",
    messages: [
      { id: "u", role: "user", parts: [{ type: "text", text: "Hello" }] },
    ],
  });
  for await (const _ of stream) {
    /* consume */
  }
  expect(model.doStreamCalls[0].tools?.map((t) => t.name)).not.toContain(
    "web_search",
  );
  expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toContain(
    "Public web tools are enabled",
  );
});
