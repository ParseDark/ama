import { it, expect } from "vitest";
import { pickRelevant, embedQuery } from "@/lib/memory/retrieval";
import { DEFAULT_EMBEDDING } from "@/lib/settings";
import { loadMemoryContext, referenceSearch } from "@/lib/memory/context";
import { memory } from "./helpers";
import { setMemoryEnabled } from "@/lib/memory/store";
it("uses score floor, median margin and topK", () => {
  expect(
    pickRelevant(
      new Map([
        ["a", 0.8],
        ["b", 0.7],
        ["c", 0.69],
        ["d", 0.1],
      ]),
      { minScore: 0.28 },
    ),
  ).toEqual(["a"]);
  expect(
    pickRelevant(
      new Map([
        ["a", 0.3],
        ["b", 0.29],
      ]),
      { minScore: 0.28 },
    ),
  ).toEqual(["a", "b"]);
});
it("off/empty/failure query returns null and references fall back to keywords", async () => {
  expect(await embedQuery("x", DEFAULT_EMBEDDING)).toBeNull();
  expect(
    await embedQuery("", { ...DEFAULT_EMBEDDING, enabled: true }),
  ).toBeNull();
  expect(
    await embedQuery(
      "x",
      { ...DEFAULT_EMBEDDING, enabled: true },
      {
        fetchFn: async () => {
          throw Error();
        },
      },
    ),
  ).toBeNull();
  const refs = referenceSearch(
    {
      memories: [
        memory("r", "Jira board", { category: "reference", topic: "Sprint" }),
      ],
      scores: null,
    },
    DEFAULT_EMBEDDING,
  );
  expect((await refs("Sprint")).map((m) => m.id)).toEqual(["r"]);
  await setMemoryEnabled(false);
  expect(
    (await loadMemoryContext(Promise.resolve(null), DEFAULT_EMBEDDING))
      .memories,
  ).toEqual([]);
});
