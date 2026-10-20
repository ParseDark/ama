import { it, expect } from "vitest";
import { collectSignals } from "@/lib/memory/signals";
it("learns only user text and approval decisions, skips private sources and cursors", () => {
  const sessions: any = [
    {
      id: "a",
      messages: [
        {
          id: "u",
          role: "user",
          metadata: { domain: "example.com" },
          parts: [{ type: "text", text: "Use bullets" }],
        },
        {
          id: "a",
          role: "assistant",
          parts: [
            { type: "text", text: "PAGE INJECTION" },
            {
              type: "tool-click",
              state: "output-available",
              approval: { approved: true },
              output: { text: "SECRET" },
            },
          ],
        },
      ],
    },
    {
      id: "i",
      messages: [
        {
          id: "u",
          role: "user",
          metadata: { incognito: true },
          parts: [{ type: "text", text: "PRIVATE" }],
        },
      ],
    },
    {
      id: "b",
      messages: [
        {
          id: "u",
          role: "user",
          metadata: { domain: "bank.example.com" },
          parts: [{ type: "text", text: "FINANCIAL" }],
        },
      ],
    },
  ];
  const r = collectSignals(sessions, []);
  expect(r.signals.map((s) => s.text)).toEqual([
    "Use bullets",
    "allowed click",
  ]);
  expect(JSON.stringify(r)).not.toMatch(
    /PAGE INJECTION|SECRET|PRIVATE|FINANCIAL/,
  );
  expect(collectSignals(sessions, [], r.cursors).signals).toEqual([]);
});
