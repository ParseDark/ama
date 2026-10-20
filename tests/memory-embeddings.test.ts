import { it, expect, vi } from "vitest";
import { embedTexts } from "@/lib/memory/embeddings";
import { DEFAULT_EMBEDDING } from "@/lib/settings";
it("batches 32, sorts indices, normalizes and sends type/token", async () => {
  const fetchFn = vi.fn(async (_i, n) => {
    const b = JSON.parse(n.body);
    return Response.json({
      data: b.input
        .map((_: any, index: number) => ({ index, embedding: [3, 4] }))
        .reverse(),
    });
  });
  const v = await embedTexts(
    { ...DEFAULT_EMBEDDING, token: "private" },
    Array.from({ length: 35 }, () => "x"),
    "query",
    { fetchFn },
  );
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(v).toHaveLength(35);
  expect(v[0]).toEqual([0.6, 0.8]);
  expect(JSON.parse(fetchFn.mock.calls[0][1].body).input_type).toBe("query");
  expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe("Bearer private");
});
it("rejects malformed vectors and includes structured error", async () => {
  await expect(
    embedTexts(DEFAULT_EMBEDDING, ["x"], "query", {
      fetchFn: async () =>
        Response.json({ error: { message: "bad" } }, { status: 400 }),
    }),
  ).rejects.toThrow("Embedding request failed (400): bad");
});
