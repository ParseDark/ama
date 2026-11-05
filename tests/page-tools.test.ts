import { it, expect, vi } from "vitest";
import { createPageTools, getApprovalDetails } from "@/lib/page-tools";
import { RunContext } from "@/lib/run-context";
import { describeClickTarget } from "@/lib/page-actions";
import {
  scrollPage,
  doubleClickElement,
  dragElement,
} from "@/lib/page-gestures";
import { asSchema } from "ai";
it("asks only for external tabs and committing clicks, using browser facts", async () => {
  const run = new RunContext(1),
    execute = vi.fn(async (_id, fn) =>
      fn === describeClickTarget
        ? { found: true, label: 'button "Real title"', submit: true }
        : { ok: true },
    ),
    readPage = vi.fn(async () => ({
      tabId: 1,
      url: "https://example.com",
      title: "Real page",
      markdown: "x".repeat(40000),
      elements: [],
      selection: "",
      truncated: false,
    })),
    tabs: any = {
      get: async () => ({ title: "Real tab", windowId: 1 }),
      list: async () => [],
      open: async () => ({ id: 3 }),
      switchTo: vi.fn(),
      close: vi.fn(),
    };
  const tools: any = createPageTools(run, {
    run: execute as any,
    readPage,
    tabs,
    wait: async () => {},
  });
  expect(
    await tools.fill.needsApproval({ id: "e1" }, { toolCallId: "f" }),
  ).toBe(false);
  expect(
    await tools.read_tab.needsApproval({ tab: 2 }, { toolCallId: "r" }),
  ).toBe(true);
  expect(getApprovalDetails("r")?.tabTitle).toBe("Real tab");
  expect(
    await tools.click.needsApproval({ id: "e1" }, { toolCallId: "c" }),
  ).toBe(true);
  expect(getApprovalDetails("c")?.label).toBe('button "Real title"');
  await tools.fill.execute({ id: "e1", text: "x", tab: 2 });
  expect(run.isAllowed(2)).toBe(true);
  await tools.open_tab.execute({ url: "https://example.com" });
  expect(run.owns(3)).toBe(true);
  expect((await tools.read_tab.execute({})).markdown.length).toBe(30000);
  expect((await tools.close_tab.execute({ tab: 2 })).ok).toBe(false);
  await tools.close_tab.execute({ tab: 3 });
  expect(tabs.close).toHaveBeenCalledWith(3);
});
it("approves drags, guards double-submit, and returns refreshed gesture state", async () => {
  const run = new RunContext(1);
  let committing = false;
  const execute = vi.fn(async (_tab, fn, args) =>
    fn === describeClickTarget
      ? { found: true, submit: committing, label: `item ${args[0]}` }
      : { ok: true, dispatched: true, verified: false },
  );
  const readPage = vi.fn(async (tabId: number) => ({
    tabId,
    url: "https://example.com",
    title: "After",
    markdown: "x".repeat(20000),
    elements: ["[e2] Target"],
    selection: "",
    truncated: false,
  }));
  const tools: any = createPageTools(run, {
    run: execute as any,
    readPage,
    wait: async () => {},
    tabs: { get: async () => ({ title: "Other" }) } as any,
  });
  expect(await tools.scroll.needsApproval({}, { toolCallId: "scroll" })).toBe(
    false,
  );
  expect(
    await tools.scroll.needsApproval({ tab: 2 }, { toolCallId: "external" }),
  ).toBe(true);
  expect(
    await tools.double_click.needsApproval(
      { id: "a" },
      { toolCallId: "double" },
    ),
  ).toBe(false);
  expect(
    await tools.drag.needsApproval(
      { sourceId: "a", targetId: "b" },
      { toolCallId: "drag" },
    ),
  ).toBe(true);
  expect(getApprovalDetails("drag")).toMatchObject({
    label: "item a",
    targetLabel: "item b",
  });
  const scroll = await tools.scroll.execute({ deltaX: 0, deltaY: 500 });
  expect(execute).toHaveBeenCalledWith(1, scrollPage, [null, 0, 500]);
  expect(scroll.page.markdown).toHaveLength(12000);
  expect(scroll.page.truncated).toBe(true);
  expect(scroll.page.elements).toEqual(["[e2] Target"]);
  await tools.double_click.execute({ id: "a" });
  expect(execute).toHaveBeenCalledWith(1, doubleClickElement, ["a"]);
  await tools.drag.execute({
    sourceId: "a",
    targetId: "b",
    mode: "auto",
    tab: 2,
  });
  expect(execute).toHaveBeenCalledWith(2, dragElement, ["a", "b", "auto"]);
  expect(run.isAllowed(2)).toBe(true);
  execute.mockClear();
  committing = true;
  expect((await tools.double_click.execute({ id: "a" })).ok).toBe(false);
  expect(execute).toHaveBeenCalledTimes(1);
  const schema = asSchema(tools.scroll.inputSchema);
  expect((await schema.validate!({ deltaY: 50 })).success).toBe(true);
  for (const value of [
    {},
    { deltaY: 0 },
    { deltaX: 10001 },
    { deltaY: Infinity },
  ])
    expect((await schema.validate!(value)).success).toBe(false);
});
it("does not act without a scriptable start tab", async () => {
  const tools: any = createPageTools(new RunContext());
  await expect(tools.fill.execute({ id: "e1", text: "x" })).rejects.toThrow(
    "No tab to act on",
  );
});
