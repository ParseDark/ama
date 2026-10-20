import { it, expect, vi } from "vitest";
import { judgeRelations, relateToExisting } from "@/lib/memory/relation";
import { findSimilarPairs, refineLearnedOps } from "@/lib/memory/dedupe";
import { DEFAULT_EMBEDDING } from "@/lib/settings";
import { memory, jsonModel } from "./helpers";
it("filters unknown ids and picks only similar same-scope candidates", async () => {
  const ms = [
    memory("a", "Chinese"),
    memory("b", "English", { scope: "domain:example.com" }),
  ];
  const r = await judgeRelations("English", ms, [
    jsonModel({
      relations: [
        { id: "a", relation: "contradicts" },
        { id: "unknown", relation: "duplicate" },
      ],
    }),
  ]);
  expect([...r!.keys()]).toEqual(["a"]);
  const judge = vi.fn(
    async (_text: string, _candidates: any[]) =>
      new Map([["a", "contradicts" as const]]),
  );
  expect(
    await relateToExisting("English", "global", ms, {
      config: { ...DEFAULT_EMBEDDING, enabled: true },
      embedDocuments: async (ts) => ts.map(() => [1, 0]),
      judge,
    }),
  ).toEqual({ duplicateOf: undefined, contradicts: ["a"] });
  expect(judge.mock.calls[0][1]).toHaveLength(1);
});
it("distinct pairs hidden and dismissed duplicate/owned contradiction dropped", async () => {
  const ms = [memory("a", "Bullets"), memory("b", "Bullet points")];
  const args = {
    config: { ...DEFAULT_EMBEDDING, enabled: true },
    embedDocuments: async (ts: string[]) => ts.map(() => [1, 0]),
  };
  expect(await findSimilarPairs(ms, args)).toHaveLength(1);
  expect(await findSimilarPairs(ms, { ...args, distinct: ["a|b"] })).toEqual(
    [],
  );
  const op: any = { op: "add", text: "Other", reason: "Repeated" };
  expect(
    await refineLearnedOps(
      [op],
      [memory("a", "A", { status: "dismissed" })],
      async () => ({ duplicateOf: "a", contradicts: [] }),
    ),
  ).toEqual([]);
  expect(
    await refineLearnedOps([op], ms, async () => ({ contradicts: ["a"] })),
  ).toEqual([]);
});
