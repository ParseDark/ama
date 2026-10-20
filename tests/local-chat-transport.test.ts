import { it, expect, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { LocalChatTransport } from "@/lib/local-chat-transport";
import {
  DEFAULT_SETTINGS,
  DEFAULT_EMBEDDING,
  settingsStore,
} from "@/lib/settings";
import { upsertMemory, setMemoryEnabled } from "@/lib/memory/store";
import { memory } from "./helpers";
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
it("shares exactly one query embedding, emits metadata and injects no memory when off", async () => {
  await upsertMemory(
    memory("p", "Use concise answers", { category: "preference" }),
  );
  const fetchFn = vi.fn(async () =>
    Response.json({ data: [{ index: 0, embedding: [1, 0] }] }),
  );
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          c.enqueue({ type: "text-start", id: "t" });
          c.enqueue({ type: "text-delta", id: "t", delta: "Hello" });
          c.enqueue({ type: "text-end", id: "t" });
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
    loadSettings: async () => ({
      ...DEFAULT_SETTINGS,
      embedding: { ...DEFAULT_EMBEDDING, enabled: true },
    }),
    readActivePage: async () => ({
      tabId: 1,
      title: "Test",
      url: "https://example.com",
      markdown: "PAGE",
      selection: "",
      elements: [],
      truncated: false,
    }),
    createModel: async () => model as any,
    embeddingFetch: fetchFn,
  });
  const args: any = {
    chatId: "c",
    trigger: "submit-message",
    messages: [
      { id: "u", role: "user", parts: [{ type: "text", text: "Hello" }] },
    ],
  };
  const stream = await transport.sendMessages(args),
    chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(fetchFn).toHaveBeenCalledOnce();
  expect(chunks.find((c) => c.type === "finish")).toMatchObject({
    messageMetadata: {
      generationStats: {
        version: 1,
        requests: 1,
        status: "complete",
        usageComplete: true,
        inputTokens: 1,
        outputTokens: 1,
        firstTokenMs: expect.any(Number),
        totalMs: expect.any(Number),
      },
    },
  });
  expect(chunks.find((c) => c.type === "start")).toMatchObject({
    messageMetadata: {
      usedMemories: [{ id: "p", text: "Use concise answers" }],
    },
  });
  expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain(
    "<user_memory>",
  );
  await setMemoryEnabled(false);
  const second = await transport.sendMessages(args);
  for await (const _ of second) {
  }
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).not.toContain(
    "Use concise answers",
  );
});

it("reports last-step usage, run totals and a calibrated breakdown across steps", async () => {
  await upsertMemory(
    memory("p", "Use concise answers", { category: "preference" }),
  );
  const step1 = {
      inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 20, text: 20, reasoning: 0 },
    },
    step2 = {
      inputTokens: {
        total: 1200,
        noCache: 200,
        cacheRead: 1000,
        cacheWrite: 0,
      },
      outputTokens: { total: 50, text: 50, reasoning: 0 },
    };
  let step = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          const current = step++;
          c.enqueue({ type: "stream-start", warnings: [] });
          if (current === 0)
            c.enqueue({
              type: "tool-call",
              toolCallId: "c1",
              toolName: "get_settings",
              input: "{}",
            });
          else {
            c.enqueue({ type: "text-start", id: "t" });
            c.enqueue({ type: "text-delta", id: "t", delta: "Done" });
            c.enqueue({ type: "text-end", id: "t" });
          }
          c.enqueue({
            type: "finish",
            finishReason: {
              unified: current === 0 ? "tool-calls" : "stop",
              raw: "stop",
            },
            usage: current === 0 ? step1 : step2,
          });
          c.close();
        },
      }),
    }),
  });
  const transport = new LocalChatTransport({
    loadSettings: async () => ({
      ...DEFAULT_SETTINGS,
      embedding: { ...DEFAULT_EMBEDDING, enabled: false },
    }),
    saveSettings: async (s) => {
      await settingsStore.setValue(s);
    },
    readActivePage: async () => ({
      tabId: 1,
      title: "Test",
      url: "https://example.com",
      markdown: "PAGE ".repeat(100),
      selection: "",
      elements: [],
      truncated: false,
    }),
    createModel: async () => model as any,
  });
  const stream = await transport.sendMessages({
    chatId: "usage",
    trigger: "submit-message",
    messages: [
      { id: "u", role: "user", parts: [{ type: "text", text: "Hello" }] },
    ],
  } as any);
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  const finish = chunks.find((c) => c.type === "finish");
  expect(finish.messageMetadata.usage).toMatchObject({
    model: "openai-compatible/claude-haiku-5-5",
    contextTokens: 1250,
    inputTokens: 1200,
    outputTokens: 50,
    cachedInputTokens: 1000,
    total: {
      inputTokens: 2200,
      outputTokens: 70,
      cachedInputTokens: 1000,
      cacheWriteTokens: 0,
    },
  });
  const breakdown = finish.messageMetadata.usage.breakdown;
  expect(
    breakdown.system +
      breakdown.tools +
      breakdown.page +
      breakdown.memory +
      breakdown.conversation +
      breakdown.run +
      breakdown.output,
  ).toBe(1250);
  expect(breakdown.run).toBe(200);
  expect(breakdown.output).toBe(50);
  expect(breakdown.page).toBeGreaterThan(0);
  expect(breakdown.memory).toBeGreaterThan(0);
  expect(chunks.find((c) => c.type === "start")).toMatchObject({
    messageMetadata: { usedMemories: [{ id: "p" }] },
  });
});
