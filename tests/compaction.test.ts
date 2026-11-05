import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import type { ModelMessage, UIMessage } from "ai";
import {
  budgetPage,
  compactHistory,
  contextBudget,
  hasPendingTools,
  historyCut,
  modelMessageTokens,
  stepCut,
  summarizeText,
  textTokens,
  thinToolResults,
  validRecord,
} from "@/lib/compaction";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
  deleteSession,
  loadCompact,
  saveCompact,
  saveSession,
  loadSession,
} from "@/lib/sessions";
import { createChatHistoryTool } from "@/lib/chat-history-tool";

export const history = (): UIMessage[] =>
  Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    role: i % 2 ? "assistant" : "user",
    parts: [
      {
        type: "text",
        text:
          i < 4
            ? `Source-${i} 用户禁止支付 ${"facts ".repeat(2500)}`
            : `Recent-${i}`,
      },
    ],
  }));
const summarize = vi.fn(async () => ({
  text: "Goal: read source. Constraint: user denied payment. Pending: verify dataId abc, https://example.com. No approval granted.",
  inputTokens: 100,
  outputTokens: 20,
}));

it("separates total-window/output reserves, input limits, overrides and unknown fallback", () => {
  const base = {
    ...DEFAULT_SETTINGS,
    provider: "openai-compatible" as const,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      "openai-compatible": {
        apiKey: "x",
        baseURL: "http://a",
        model: "unknown-test",
        modelInfo: {
          "unknown-test": {
            maxInputTokens: 100000,
            contextWindowTokens: 120000,
            maxOutputTokens: 32000,
          },
        },
      },
    },
  };
  expect(contextBudget(base)).toMatchObject({
    total: 120000,
    input: 85000,
    output: 8192,
    fallback: false,
  });
  expect(
    contextBudget({
      ...base,
      compaction: { enabled: true, contextTokens: 200000 },
    }).input,
  ).toBeGreaterThan(100000);
  const unknown: import("@/lib/settings").Settings = structuredClone(base);
  delete unknown.providers["openai-compatible"].modelInfo;
  expect(contextBudget(unknown)).toMatchObject({
    total: 32768,
    fallback: true,
  });
});

it("summarizes only old completed turns, validates content boundaries, never mutates history", async () => {
  const messages = history(),
    original = structuredClone(messages);
  expect(historyCut(messages)).toBe(4);
  const record = (await compactHistory(
    messages,
    null,
    summarize,
    24000,
    "test",
  ))!;
  expect(record).toMatchObject({
    version: 1,
    covered: 4,
    model: "test",
    inputTokens: expect.any(Number),
  });
  expect(record.beforeTokens).toBeGreaterThan(record.afterTokens);
  expect(messages).toEqual(original);
  expect(await validRecord(record, messages)).toBe(true);
  const reordered = messages.map((m) => ({
    parts: m.parts.map((p) => Object.fromEntries(Object.entries(p).reverse())),
    role: m.role,
    id: m.id,
  })) as UIMessage[];
  expect(await validRecord(record, reordered)).toBe(true);
  messages[7]!.parts = [
    { type: "text", text: "recent edit is outside prefix" },
  ];
  expect(await validRecord(record, messages)).toBe(true);
  messages[0]!.parts = [{ type: "text", text: "changed old instruction" }];
  expect(await validRecord(record, messages)).toBe(false);
  expect(
    await compactHistory(original.slice(0, 2), null, summarize, 24000, "test"),
  ).toBeNull();
});

it("retains pending approvals, malformed interrupted tools, denial receipts and two recent turns", async () => {
  const messages = history();
  messages[3]!.parts.push({
    type: "tool-click",
    toolCallId: "c",
    input: { id: "x" },
    state: "approval-requested",
    approval: { id: "a" },
  } as any);
  expect(hasPendingTools(messages)).toBe(true);
  expect(historyCut(messages)).toBe(2);
  messages[3]!.parts[1] = {
    type: "tool-click",
    toolCallId: "c",
    input: { id: "x" },
    state: "output-denied",
    approval: { id: "a", approved: false },
  } as any;
  expect(hasPendingTools(messages)).toBe(false);
  expect(historyCut(messages)).toBe(4);
  const spy = vi.fn(async () => ({ text: "User denied click. Never retry." }));
  await compactHistory(messages, null, spy, 24000, "test");
  expect(spy.mock.calls.map((c) => (c as any)[0]).join("")).toContain(
    "output-denied",
  );
});

it("chunks oversized source; empty/failed/non-shrinking summaries and abort do not commit", async () => {
  const spy = vi.fn(async (source: string) => {
    expect(textTokens(source)).toBeLessThan(8000);
    return { text: "Handoff " + "x".repeat(50) };
  });
  await summarizeText("中".repeat(20000), "", spy, 16000);
  expect(spy.mock.calls.length).toBeGreaterThan(2);
  await expect(
    compactHistory(history(), null, async () => ({ text: "" }), 24000, "test"),
  ).rejects.toThrow("Invalid Compact");
  const short = history().map((m) => ({
    ...m,
    parts: [{ type: "text" as const, text: "Hi" }],
  }));
  await expect(
    compactHistory(
      short,
      null,
      async () => ({ text: "unnecessarily long summary ".repeat(80) }),
      24000,
      "test",
    ),
  ).rejects.toThrow("would not reduce");
  const abort = new AbortController();
  abort.abort();
  await expect(
    compactHistory(history(), null, summarize, 24000, "test", abort.signal),
  ).rejects.toThrow();
});

it("stores compact independently, preserves transcript and deletion tombstones", async () => {
  const messages = history();
  await saveSession("compact-store", messages);
  const record = (await compactHistory(
    messages,
    null,
    summarize,
    24000,
    "test",
  ))!;
  await saveCompact("compact-store", record);
  expect(await loadSession("compact-store")).toEqual(messages);
  expect(await loadCompact("compact-store")).toEqual(record);
  await deleteSession("compact-store");
  await saveCompact("compact-store", record);
  expect(await loadCompact("compact-store")).toBeNull();
});

it("caps page context by complete elements and records truncation", () => {
  const page = budgetPage(
    {
      tabId: 1,
      title: "title",
      url: "https://a",
      markdown: "中".repeat(20000),
      selection: "s".repeat(10000),
      elements: Array.from(
        { length: 400 },
        (_, i) => `[${i}] button ${"name".repeat(20)}`,
      ),
      truncated: false,
    },
    16000,
  )!;
  expect(page.truncated).toBe(true);
  expect(
    textTokens(page.markdown + page.selection + page.elements.join("\n")),
  ).toBeLessThan(4000);
  expect(page.elements[0]).toContain("[0]");
});

it("thins earlier observations but preserves latest sources, mutating receipts and call pairs", () => {
  const messages: ModelMessage[] = Array.from({ length: 4 }, (_, i) => ({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: String(i),
        toolName: "read_tab",
        output: { type: "text", value: "PAGE ".repeat(10000) },
      },
    ],
  }));
  messages.push({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "write",
        toolName: "click",
        output: { type: "text", value: "receipt ".repeat(10000) },
      },
    ],
  });
  const result = thinToolResults(messages);
  expect(result.length).toBe(messages.length);
  expect(modelMessageTokens(result)).toBeLessThan(modelMessageTokens(messages));
  expect(result[2]).toEqual(messages[2]);
  expect(result[4]).toEqual(messages[4]);
  expect(JSON.stringify(result[0])).toContain('"toolCallId":"0"');
  expect(JSON.stringify(messages[0])).not.toContain(
    "Earlier observation excerpt",
  );
});

it("compacts in-run prefixes only at complete tool step boundaries", () => {
  const steps: ModelMessage[] = [{ role: "user", content: "Current request" }];
  for (let i = 0; i < 4; i++)
    steps.push(
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: String(i),
            toolName: "read_tab",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: String(i),
            toolName: "read_tab",
            output: { type: "text", value: "PAGE" },
          },
        ],
      },
    );
  expect(stepCut(steps)).toEqual({ start: 1, end: 5 });
  const broken = structuredClone(steps);
  broken.splice(2, 1);
  expect(stepCut(broken)).toBeNull();
  const approval = structuredClone(steps);
  (approval[1]!.content as any[]).push({
    type: "tool-approval-request",
    approvalId: "a",
    toolCallId: "0",
  });
  expect(stepCut(approval)).toBeNull();
});

it("reads only this chat with bounded text pagination, omits image bytes/reasoning and never replays tools", async () => {
  const messages = history();
  messages[0]!.parts.push(
    { type: "reasoning", text: "PRIVATE REASONING" },
    {
      type: "file",
      mediaType: "image/png",
      url: "data:image/png;base64,SECRET",
    },
  );
  const tools = createChatHistoryTool(messages);
  const result: any = await tools.read_chat_history.execute!(
    { offset: 0, limit: 2, query: "Source-", textOffset: 0 },
    {} as any,
  );
  expect(result).toMatchObject({ total: 4, nextOffset: 2 });
  expect(result.messages.map((m: any) => m.index)).toEqual([0, 1]);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE REASONING|base64,SECRET/);
  expect(textTokens(JSON.stringify(result))).toBeLessThan(4000);
  const next = result.messages[0].nextTextOffset;
  expect(next).toBeGreaterThan(0);
  const continuation: any = await tools.read_chat_history.execute!(
    { offset: 0, limit: 1, query: "Source-", textOffset: next },
    {} as any,
  );
  expect(continuation.messages[0].textOffset).toBe(next);
  expect(continuation.messages[0].text).not.toContain("Source-0");
});
