import "fake-indexeddb/auto";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { reviewMemory, runMemoryMaintenance } from "@/lib/memory/maintenance";
import { sourcedSignal } from "@/lib/memory/provenance";
import { memory, jsonModel } from "./helpers";
import {
  upsertMemory,
  listMemories,
  resolveMemoryReview,
  setMemoryEnabled,
  exportMemories,
  importMemories,
} from "@/lib/memory/store";
import { saveSession, deleteSession } from "@/lib/sessions";
const original = sourcedSignal("audit", "u1", "user_msg", "Use brief answers");
const recent = sourcedSignal(
  "audit",
  "u2",
  "user_msg",
  "From now on use detailed answers",
);
beforeEach(() =>
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn(async (_n: any, options: any, fn?: any) =>
        (fn ?? options)({}),
      ),
    },
  }),
);
afterEach(() => vi.restoreAllMocks());
it("requires actual evidence and rejects forged sources, secrets and absent originals", async () => {
  const m = memory("m", "Prefers brief answers", {
    sources: [original.source!],
  });
  const proposal = {
    action: "revise",
    text: "Prefers detailed answers",
    reason: "User changed preference",
    sourceIds: [recent.source!.id],
  };
  expect(
    await reviewMemory(m, [original], [recent], [jsonModel(proposal)]),
  ).toMatchObject({ action: "revise", sources: [recent.source] });
  expect(await reviewMemory(m, [], [recent], [jsonModel(proposal)])).toBeNull();
  expect(
    await reviewMemory(
      m,
      [original],
      [recent],
      [jsonModel({ ...proposal, sourceIds: ["forged"] })],
    ),
  ).toBeNull();
  expect(
    await reviewMemory(
      m,
      [original],
      [recent],
      [jsonModel({ ...proposal, text: "password is secret" })],
    ),
  ).toBeNull();
});
it("audits without new learning signals, preserves owned text until acceptance, roundtrips provenance", async () => {
  await saveSession(
    "audit",
    [original, recent].map((s, i) => ({
      id: `u${i + 1}`,
      role: "user" as const,
      parts: [{ type: "text" as const, text: s.text }],
    })),
  );
  await upsertMemory(
    memory("m", "Prefers brief answers", {
      category: "preference",
      sources: [original.source!],
      verification: "user-confirmed",
    }),
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: "c",
                type: "function",
                function: {
                  name: "answer",
                  arguments: JSON.stringify({
                    action: "revise",
                    text: "Prefers detailed answers",
                    reason: "Explicit change",
                    sourceIds: [recent.source!.id],
                  }),
                },
              },
            ],
          },
        },
      ],
    }),
  );
  const result = await runMemoryMaintenance({ force: true });
  expect(result).toMatchObject({
    status: "done",
    reviewed: 1,
  });
  expect((await listMemories())[0]).toMatchObject({
    text: "Prefers brief answers",
    review: { text: "Prefers detailed answers" },
  });
  const exported = await exportMemories();
  await importMemories(exported);
  expect((await listMemories())[0].review?.sources).toEqual([recent.source]);
  await resolveMemoryReview("m", true);
  expect((await listMemories())[0]).toMatchObject({
    text: "Prefers detailed answers",
    verification: "user-confirmed",
  });
  expect((await listMemories())[0].review).toBeUndefined();
  expect((await listMemories())[0].changes?.at(-1)?.previousText).toBe(
    "Prefers brief answers",
  );
  await setMemoryEnabled(false);
  expect((await runMemoryMaintenance({ force: true })).status).toBe("off");
});
it("does not invent evidence when the source was deleted", async () => {
  await saveSession("audit", [
    { id: "u1", role: "user", parts: [{ type: "text", text: original.text }] },
  ]);
  await upsertMemory(
    memory("m", "Prefers brief answers", { sources: [original.source!] }),
  );
  await deleteSession("audit");
  const fetch = vi.spyOn(globalThis, "fetch");
  expect((await runMemoryMaintenance({ force: true })).status).toBe("nothing");
  expect(fetch).not.toHaveBeenCalled();
  expect((await listMemories())[0].review).toBeUndefined();
});
