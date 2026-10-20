import { tool } from "ai";
import { z } from "zod";
import type { Exchange } from "./history-search";
export function createHistoryTools({
  search,
}: {
  search: (query: string) => Promise<Exchange[]>;
}) {
  return {
    search_history: tool({
      description:
        'Search the user\'s earlier chats (not this one) by meaning. Use it when the user refers to a previous conversation, e.g. "last time", "上次", "like before".',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const hits = await search(query);
        return hits.length
          ? {
              results: hits.map((e) => ({
                chat: e.sessionTitle,
                date: new Date(e.updatedAt).toISOString().slice(0, 10),
                question: e.question,
                answer: e.answer,
              })),
            }
          : { results: [], note: "No earlier chat matches." };
      },
    }),
  };
}
