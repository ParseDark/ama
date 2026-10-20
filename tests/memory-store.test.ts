import { it, expect } from "vitest";
import {
  upsertMemory,
  listMemories,
  importMemories,
  undoRemember,
  markDistinct,
  distinctStore,
  keepMemory,
} from "@/lib/memory/store";
import { memory } from "./helpers";
it("validates before import and merges ids", async () => {
  await upsertMemory(memory("a", "A"));
  await expect(
    importMemories('{"schemaVersion":1,"memories":[{}]}'),
  ).rejects.toThrow();
  expect(await listMemories()).toHaveLength(1);
  await importMemories(
    JSON.stringify({
      schemaVersion: 1,
      memories: [memory("a", "Edited"), memory("b", "B")],
    }),
  );
  expect((await listMemories()).map((m) => m.text)).toEqual(["Edited", "B"]);
});
it("undo restores replaced memories and merge sums evidence and pin", async () => {
  await upsertMemory(
    memory("a", "A", { disabled: true, supersededBy: "b", evidence: 2 }),
  );
  await upsertMemory(memory("b", "B"));
  await undoRemember("b", ["a"]);
  expect((await listMemories())[0]).toMatchObject({ disabled: false });
  expect((await listMemories())[0].supersededBy).toBeUndefined();
  await upsertMemory(memory("c", "C", { pinned: true, evidence: 3 }));
  await keepMemory("a", "c");
  expect((await listMemories())[0]).toMatchObject({
    evidence: 5,
    pinned: true,
  });
  await markDistinct("z", "a");
  expect(await distinctStore.getValue()).toEqual(["a|z"]);
});
