import { it, expect } from "vitest";
import { exchanges, searchHistory } from "@/lib/history-search";
import { saveSession } from "@/lib/sessions";
import { DEFAULT_EMBEDDING } from "@/lib/settings";
import { createHistoryTools } from "@/lib/history-tools";
const summary = { id: "a", title: "Kafka", createdAt: 1, updatedAt: 2 };
const messages: any = [
  {
    id: "u",
    role: "user",
    parts: [{ type: "text", text: "Kafka retry plan" }],
  },
  {
    id: "a",
    role: "assistant",
    parts: [{ type: "text", text: "Use exponential backoff" }],
  },
  {
    id: "i",
    role: "user",
    metadata: { incognito: true },
    parts: [{ type: "text", text: "Private" }],
  },
];
it("skips private/empty exchanges, excludes current and ranks keywords", async () => {
  expect(exchanges(summary, messages)).toHaveLength(1);
  await saveSession("a", messages);
  await saveSession("b", [
    { id: "b", role: "user", parts: [{ type: "text", text: "Weekend plan" }] },
  ]);
  expect(
    (await searchHistory("Kafka", { config: DEFAULT_EMBEDDING }))[0].answer,
  ).toContain("backoff");
  expect(
    await searchHistory("Kafka", {
      config: DEFAULT_EMBEDDING,
      excludeSessionId: "a",
    }),
  ).toEqual([]);
});
it("history tool has stable output shape", async () => {
  const tools: any = createHistoryTools({
    search: async () => exchanges(summary, messages),
  });
  expect(await tools.search_history.execute({ query: "retry" })).toMatchObject({
    results: [
      {
        chat: "Kafka",
        question: "Kafka retry plan",
        answer: "Use exponential backoff",
      },
    ],
  });
});
