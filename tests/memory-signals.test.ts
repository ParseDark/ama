import { it, expect } from "vitest";
import { collectSignals } from "@/lib/memory/signals";
it("batches without advancing past unconsumed sessions or same-time events", () => {
  const messages: any[] = Array.from({ length: 100 }, (_, i) => ({
    id: `u${i}`,
    role: "user",
    parts: [{ type: "text", text: `Signal ${i}` }],
  }));
  const sessions = [
    { id: "a", messages },
    { id: "b", messages: messages.slice(0, 1) },
  ];
  const events: any[] = Array.from({ length: 3 }, (_, i) => ({
    ts: 100,
    type: "stop",
    sessionId: `s${i}`,
  }));
  const first = collectSignals(sessions, events);
  expect(first.signals).toHaveLength(60);
  expect(first.cursors).toEqual({ a: 60, b: 0 });
  expect(first.pending).toBe(true);
  const second = collectSignals(
    sessions,
    events,
    first.cursors,
    first.eventCursor,
  );
  expect(second.signals).toHaveLength(44);
  expect(second.cursors).toEqual({ a: 100, b: 1 });
  expect(
    collectSignals(sessions, events, second.cursors, second.eventCursor)
      .signals,
  ).toEqual([]);
  const sameTime = collectSignals([], events, {}, 0, 1);
  expect(sameTime.signals).toHaveLength(3);
  expect(sameTime.eventCursor).toBe(100);
});
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
