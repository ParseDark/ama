import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { UIMessage } from "ai";
import { LocalChatTransport } from "@/lib/local-chat-transport";
import {
  DEFAULT_SETTINGS,
  DEFAULT_EMBEDDING,
  type Settings,
} from "@/lib/settings";
import { loadCompact, saveSession, loadSession } from "@/lib/sessions";
import { contextBudget } from "@/lib/compaction";
const settings: Settings = {
  ...DEFAULT_SETTINGS,
  embedding: { ...DEFAULT_EMBEDDING, enabled: false },
  compaction: { enabled: true, contextTokens: 32768 },
};
const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};
function model() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          c.enqueue({ type: "text-start", id: "t" });
          c.enqueue({ type: "text-delta", id: "t", delta: "done" });
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
}
const oldHistory = (): UIMessage[] =>
  Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    role: i % 2 ? "assistant" : "user",
    parts: [
      {
        type: "text",
        text: i < 4 ? `OLD-SOURCE-${i} ${"事实".repeat(14000)}` : `RECENT-${i}`,
      },
    ],
  }));
async function consume(stream: ReadableStream) {
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

it("automatically compacts over-budget history, sends only handoff + recent turns, and preserves originals", async () => {
  const messages = oldHistory(),
    llm = model();
  await saveSession("auto", messages);
  const summarize = vi.fn(async () => ({
    text: "User constraint: do not pay. Confirmed source https://example.com; dataId abc. Pending verify. No approval.",
    inputTokens: 500,
    outputTokens: 30,
  }));
  const transport = new LocalChatTransport({
    loadSettings: async () => settings,
    readActivePage: async () => null,
    createModel: async () => llm,
    summarize,
  });
  const chunks = await consume(
    await transport.sendMessages({
      chatId: "auto",
      trigger: "submit-message",
      messages,
    } as any),
  );
  expect(chunks.filter((c) => c.type === "error")).toEqual([]);
  const prompt = JSON.stringify(llm.doStreamCalls[0]!.prompt);
  expect(prompt).toContain("No approval");
  expect(prompt).toContain("RECENT-4");
  expect(prompt).not.toContain("OLD-SOURCE-0");
  expect(await loadSession("auto")).toEqual(messages);
  expect(await loadCompact("auto")).toMatchObject({ covered: 4 });
  expect(
    chunks.find((c) => c.type === "finish").messageMetadata.compaction,
  ).toMatchObject({ covered: 4, inputTokens: expect.any(Number) });
  expect(llm.doStreamCalls[0]!.maxOutputTokens).toBe(
    contextBudget(settings).output,
  );
  const calls = summarize.mock.calls.length;
  await consume(
    await transport.sendMessages({
      chatId: "auto",
      trigger: "submit-message",
      messages,
    } as any),
  );
  expect(summarize.mock.calls.length).toBe(calls);
});

it("manual Compact refuses pending approvals and automatically retained approval responses still reach the model", async () => {
  const messages = oldHistory(),
    llm = model();
  messages.push({
    id: "pending",
    role: "assistant",
    parts: [
      {
        type: "tool-read_chat_history",
        toolCallId: "pending-call",
        state: "approval-requested",
        input: { offset: 0, limit: 1 },
        approval: { id: "approval" },
      },
    ],
  } as any);
  const summarize = vi.fn(async () => ({
    text: "Historical handoff: no write approval granted.",
  }));
  const transport = new LocalChatTransport({
    loadSettings: async () => settings,
    readActivePage: async () => null,
    createModel: async () => llm,
    summarize,
  });
  await expect(transport.compact("pending", messages)).rejects.toThrow(
    "pending tool approvals",
  );
  expect(summarize).not.toHaveBeenCalled();
  messages.at(-1)!.parts[0] = {
    type: "tool-read_chat_history",
    toolCallId: "pending-call",
    state: "approval-responded",
    input: { offset: 0, limit: 1 },
    approval: { id: "approval", approved: false },
  } as any;
  const chunks = await consume(
    await transport.sendMessages({
      chatId: "pending",
      trigger: "submit-message",
      messages,
    } as any),
  );
  expect(chunks.filter((c) => c.type === "error")).toEqual([]);
  expect(JSON.stringify(llm.doStreamCalls[0]!.prompt)).toContain(
    "pending-call",
  );
  expect(JSON.stringify(llm.doStreamCalls[0]!.prompt)).toContain("denied");
  expect(await loadCompact("pending")).toMatchObject({ covered: 4 });
});

it("automatic off blocks oversized calls instead of silently discarding history", async () => {
  const llm = model(),
    summarize = vi.fn();
  const transport = new LocalChatTransport({
    loadSettings: async () => ({
      ...settings,
      compaction: { ...settings.compaction!, enabled: false },
    }),
    readActivePage: async () => null,
    createModel: async () => llm,
    summarize,
  });
  const chunks = await consume(
    await transport.sendMessages({
      chatId: "off",
      trigger: "submit-message",
      messages: oldHistory(),
    } as any),
  );
  expect(
    chunks.some(
      (c) =>
        c.type === "error" && c.errorText.includes("Context budget exceeded"),
    ),
  ).toBe(true);
  expect(llm.doStreamCalls).toHaveLength(0);
  expect(summarize).not.toHaveBeenCalled();
});

it("summary failures and cancellation never replace a committed summary or send oversized history", async () => {
  const llm = model();
  const transport = new LocalChatTransport({
    loadSettings: async () => settings,
    readActivePage: async () => null,
    createModel: async () => llm,
    summarize: async () => {
      throw new Error("provider unavailable");
    },
  });
  await expect(
    transport.sendMessages({
      chatId: "failed",
      trigger: "submit-message",
      messages: oldHistory(),
    } as any),
  ).rejects.toThrow("provider unavailable");
  expect(await loadCompact("failed")).toBeNull();
  expect(llm.doStreamCalls).toHaveLength(0);
  const abort = new AbortController();
  const cancelled = new LocalChatTransport({
    loadSettings: async () => settings,
    createModel: async () => llm,
    summarize: async () => {
      abort.abort();
      return { text: "Summary" };
    },
  });
  await expect(
    cancelled.compact("cancelled", oldHistory(), abort.signal),
  ).rejects.toThrow();
  expect(await loadCompact("cancelled")).toBeNull();
});

it("checks every model step and compacts an oversized in-run read loop without losing call/result pairs", async () => {
  let n = 0;
  const llm = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          const current = n++;
          if (current < 6)
            c.enqueue({
              type: "tool-call",
              toolCallId: `c${current}`,
              toolName: "read_chat_history",
              input: '{"offset":0,"limit":1}',
            });
          else {
            c.enqueue({ type: "text-start", id: "t" });
            c.enqueue({ type: "text-delta", id: "t", delta: "done" });
            c.enqueue({ type: "text-end", id: "t" });
          }
          c.enqueue({
            type: "finish",
            finishReason: {
              unified: current < 6 ? "tool-calls" : "stop",
              raw: "stop",
            },
            usage,
          });
          c.close();
        },
      }),
    }),
  });
  const summarize = vi.fn(async () => ({
    text: "Previous reads completed; user requested analysis, no writes approved.",
    inputTokens: 100,
    outputTokens: 20,
  }));
  const transport = new LocalChatTransport({
    loadSettings: async () => ({
      ...settings,
      compaction: { enabled: true, contextTokens: 48000 },
    }),
    readActivePage: async () => null,
    createModel: async () => llm,
    summarize,
  });
  const messages: UIMessage[] = [
    {
      id: "u",
      role: "user",
      parts: [{ type: "text", text: "Read the source. " + "中".repeat(14000) }],
    },
  ];
  const chunks = await consume(
    await transport.sendMessages({
      chatId: "loop",
      trigger: "submit-message",
      messages,
    } as any),
  );
  expect(chunks.filter((c) => c.type === "error")).toEqual([]);
  expect(llm.doStreamCalls).toHaveLength(7);
  expect(summarize).toHaveBeenCalled();
  expect(
    chunks.find((c) => c.type === "finish").messageMetadata.runCompaction,
  ).toMatchObject({
    count: expect.any(Number),
    inputTokens: expect.any(Number),
  });
  for (const call of llm.doStreamCalls) {
    const ids = new Set(
      call.prompt.flatMap((m) =>
        m.role === "assistant"
          ? m.content.flatMap((p) =>
              p.type === "tool-call" ? [p.toolCallId] : [],
            )
          : [],
      ),
    );
    for (const m of call.prompt)
      if (m.role === "tool")
        for (const p of m.content)
          if (p.type === "tool-result")
            expect(ids.has(p.toolCallId)).toBe(true);
  }
});
