import { it, expect, vi } from "vitest";
import { createMemoryTools, getMemoryApprovalReason } from "@/lib/memory/tools";
import {
  listMemories,
  setMemoryEnabled,
  upsertMemory,
  undoRemember,
} from "@/lib/memory/store";
import { memory } from "./helpers";
import { planMemories, splitMemoryBlocks } from "@/lib/memory/selector";
const make = (patch: any = {}) =>
  createMemoryTools({
    domain: "example.com",
    userTexts: ["remember my preferences"],
    judgeIntent: async () => true,
    searchReferences: async () => [],
    ...patch,
  }) as any;
it("memoizes intent and requires approval for doubtful saves and foreign links", async () => {
  const judgeIntent = vi.fn(async () => false),
    tools = make({ judgeIntent });
  expect(
    await tools.remember.needsApproval(
      { text: "Use bullets" },
      { toolCallId: "a" },
    ),
  ).toBe(true);
  expect(getMemoryApprovalReason("a")).toContain("You didn't ask to save");
  expect(
    await tools.remember.needsApproval(
      { text: "Use https://example.com" },
      { toolCallId: "b" },
    ),
  ).toBe(true);
  expect(getMemoryApprovalReason("b")).toContain("link you didn't type");
  expect(judgeIntent).toHaveBeenCalledOnce();
});
it("handles memory off, exact reinforce and scope", async () => {
  const tools = make();
  await setMemoryEnabled(false);
  expect(
    await tools.remember.needsApproval({ text: "A" }, { toolCallId: "off" }),
  ).toBe(false);
  expect((await tools.remember.execute({ text: "A" })).saved).toBe(false);
  await setMemoryEnabled(true);
  await tools.remember.execute({ text: "Use bullets", scope: "site" });
  await tools.remember.execute({ text: "use bullets。", scope: "site" });
  expect(await listMemories()).toHaveLength(1);
  expect((await listMemories())[0]).toMatchObject({
    evidence: 2,
    scope: "domain:example.com",
  });
  expect(
    (await tools.forget.execute({ query: "bullets" })).removed,
  ).toHaveLength(1);
});
it("allows sensitive explicit saves with disclosure and reference-only recall", async () => {
  const tools = make();
  for (const [i, text] of [
    "My password is example-test-only",
    "My card number is 4111 1111 1111 1111",
    "My API token is example-placeholder",
  ].entries()) {
    const toolCallId = `sensitive-${i}`;
    expect(await tools.remember.needsApproval({ text }, { toolCallId })).toBe(
      true,
    );
    expect(getMemoryApprovalReason(toolCallId)).toContain("without encryption");
    expect(getMemoryApprovalReason(toolCallId)).toContain("embedding service");
    const result = await tools.remember.execute({
      text,
      category: "preference",
      topic: "Test account",
    });
    expect(result.saved).toBe(true);
    expect(
      (await listMemories()).find((m) => m.id === result.id),
    ).toMatchObject({
      text,
      category: "reference",
      topic: "Test account",
      kind: "explicit",
    });
  }
  // Existing explicit imports/preferences are corrected when saved again.
  await upsertMemory(memory("legacy", "My password is old-test-only"));
  await tools.remember.execute({ text: "My password is old-test-only" });
  expect((await listMemories()).find((m) => m.id === "legacy")).toMatchObject({
    category: "reference",
    topic: "Private reference",
  });
  const blocks = splitMemoryBlocks(planMemories(await listMemories()));
  expect(blocks.preferences).not.toContain("password");
  expect(blocks.references).not.toContain("old-test-only");
  expect(blocks.references).toContain("Private reference");
  expect(
    await tools.forget.needsApproval(
      { query: "password" },
      { toolCallId: "forget-secret" },
    ),
  ).toBe(false);
  expect(
    (await tools.forget.execute({ query: "password" })).removed,
  ).toHaveLength(2);
});

it("danger mode skips all memory approvals and the intent judge, but respects Memory Off", async () => {
  const judgeIntent = vi.fn(async () => false);
  const tools = make({ dangerMode: true, judgeIntent });
  for (const text of [
    "My password is test-only",
    "Check https://foreign.example.com",
    "Use bullets",
  ]) {
    expect(
      await tools.remember.needsApproval({ text }, { toolCallId: text }),
    ).toBe(false);
    expect((await tools.remember.execute({ text })).saved).toBe(true);
  }
  expect(
    await tools.forget.needsApproval(
      { query: "password" },
      { toolCallId: "danger-forget" },
    ),
  ).toBe(false);
  expect(judgeIntent).not.toHaveBeenCalled();
  expect(
    (await tools.forget.execute({ query: "password" })).removed,
  ).toHaveLength(1);
  await setMemoryEnabled(false);
  expect((await tools.remember.execute({ text: "Keep this" })).saved).toBe(
    false,
  );
  expect((await tools.forget.execute({ query: "bullets" })).removed).toEqual(
    [],
  );
});

it("does not recall a context captured before memory was switched off", async () => {
  const searchReferences = vi.fn(async () => [
    memory("ref", "Private reference"),
  ]);
  const tools = make({ searchReferences });
  await setMemoryEnabled(false);
  expect(await tools.recall_memory.execute({ query: "private" })).toEqual({
    matches: [],
    note: "Memory is turned off in settings.",
  });
  expect(searchReferences).not.toHaveBeenCalled();
});
it("semantic duplicates reinforce; contradictions replace and undo restores", async () => {
  await upsertMemory(memory("old", "Reply in Chinese"));
  const tools = make({ relate: async () => ({ contradicts: ["old"] }) });
  const result = await tools.remember.execute({ text: "Reply in English" });
  expect(result.replaced).toEqual([{ id: "old", text: "Reply in Chinese" }]);
  expect((await listMemories()).find((m) => m.id === "old")).toMatchObject({
    disabled: true,
    supersededBy: result.id,
  });
  await undoRemember(result.id, ["old"]);
  const duplicate = make({
    relate: async () => ({ duplicateOf: "old", contradicts: [] }),
  });
  expect(await duplicate.remember.execute({ text: "中文回答" })).toMatchObject({
    duplicate: true,
    id: "old",
  });
  expect((await listMemories())[0].evidence).toBe(2);
});
