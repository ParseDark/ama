import { it, expect, vi } from "vitest";
import { ensureVectors } from "@/lib/memory/vectors";
import { DEFAULT_EMBEDDING } from "@/lib/settings";
import { storage } from "wxt/utils/storage";
it("embeds only stale text, invalidates on model change and prunes only memories", async () => {
  const embed = vi.fn(async (ts) => ts.map(() => [1, 0]));
  await ensureVectors(
    [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    DEFAULT_EMBEDDING,
    embed,
  );
  await ensureVectors([{ id: "a", text: "A" }], DEFAULT_EMBEDDING, embed);
  expect(embed).toHaveBeenCalledOnce();
  expect(
    Object.keys((await storage.getItem<any>("local:memoryVectors")).entries),
  ).toEqual(["a"]);
  await ensureVectors([{ id: "a", text: "Changed" }], DEFAULT_EMBEDDING, embed);
  await ensureVectors(
    [{ id: "a", text: "Changed" }],
    { ...DEFAULT_EMBEDDING, model: "new" },
    embed,
  );
  expect(embed).toHaveBeenCalledTimes(3);
  await ensureVectors(
    [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    DEFAULT_EMBEDDING,
    embed,
    { namespace: "history" },
  );
  await ensureVectors([{ id: "a", text: "A" }], DEFAULT_EMBEDDING, embed, {
    namespace: "history",
  });
  expect(
    Object.keys((await storage.getItem<any>("local:vectors:history")).entries),
  ).toEqual(["a", "b"]);
});
