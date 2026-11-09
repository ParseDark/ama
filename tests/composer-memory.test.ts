import { expect, it, vi } from "vitest";
import { saveComposerMemory } from "@/lib/memory/composer-save";
import { listMemories, setMemoryEnabled } from "@/lib/memory/store";

it("saves confirmed literal text locally, reuses exact dedupe, and needs no model", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("No network expected"));
  try {
    const input = {
      text: "默认中文",
      category: "preference" as const,
      scope: "site" as const,
    };
    await saveComposerMemory(input, { domain: "example.com" });
    await saveComposerMemory(input, { domain: "example.com" });
    expect(await listMemories()).toMatchObject([
      {
        text: "默认中文",
        scope: "domain:example.com",
        verification: "user-confirmed",
      },
    ]);
    expect(await listMemories()).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});
it("preserves memory-off, private-procedure, sensitive reference and size rules", async () => {
  const input = {
    text: "Check date before export",
    category: "procedure" as const,
    scope: "global" as const,
  };
  expect(await saveComposerMemory(input, { incognito: true })).toMatchObject({
    saved: false,
  });
  expect(
    await saveComposerMemory(input, { domain: "bank.example" }),
  ).toMatchObject({ saved: false });
  await setMemoryEnabled(false);
  expect(await saveComposerMemory(input, {})).toMatchObject({ saved: false });
  await setMemoryEnabled(true);
  await expect(saveComposerMemory({ ...input, text: " " }, {})).rejects.toThrow(
    "300",
  );
  await expect(
    saveComposerMemory({ ...input, text: "x".repeat(301) }, {}),
  ).rejects.toThrow("300");
  await expect(
    saveComposerMemory({ ...input, scope: "site" }, {}),
  ).rejects.toThrow("website");
  await saveComposerMemory(
    {
      ...input,
      text: "My password is test-placeholder",
      category: "preference",
    },
    {},
  );
  expect((await listMemories())[0]).toMatchObject({ category: "reference" });
});
