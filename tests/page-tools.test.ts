import { it, expect, vi } from "vitest";
import { createPageTools, getApprovalDetails } from "@/lib/page-tools";
import { RunContext } from "@/lib/run-context";
import { describeClickTarget } from "@/lib/page-actions";
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
it("does not act without a scriptable start tab", async () => {
  const tools: any = createPageTools(new RunContext());
  await expect(tools.fill.execute({ id: "e1", text: "x" })).rejects.toThrow(
    "No tab to act on",
  );
});
