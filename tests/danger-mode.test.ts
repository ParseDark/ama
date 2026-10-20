import { expect, it, vi } from "vitest";
import { createPageTools } from "@/lib/page-tools";
import { RunContext } from "@/lib/run-context";
import { describeClickTarget } from "@/lib/page-actions";
import { buildInstructions } from "@/lib/prompt";

it("danger mode skips native browser approvals without removing tab ownership or target boundaries", async () => {
  const run = new RunContext(1);
  const execute = vi.fn(async (_id, fn) =>
    fn === describeClickTarget
      ? { found: true, submit: true, label: "Delete forever" }
      : { ok: true, found: true },
  );
  const close = vi.fn();
  const deps: any = {
    dangerMode: true,
    run: execute,
    readPage: async (id: number) => ({
      tabId: id,
      markdown: "Page",
      elements: [],
    }),
    wait: async () => {},
    tabs: {
      get: async () => ({ title: "Other" }),
      list: async () => [{ id: 2 }],
      close,
    },
  };
  const tools: any = createPageTools(run, deps);
  for (const name of ["read_tab", "fill", "select", "check", "click"]) {
    expect(
      await tools[name].needsApproval(
        { tab: 2, id: "e1" },
        { toolCallId: name },
      ),
    ).toBe(false);
  }
  expect(
    (await tools.highlight.execute({ tab: 2, id: "e1", note: "Here" })).found,
  ).toBe(true);
  expect((await tools.list_tabs.execute({})).tabs[0].access).toBe("allowed");
  await tools.click.execute({ tab: 2, id: "e1" });
  expect(execute).toHaveBeenCalled();
  expect((await tools.close_tab.execute({ tab: 2 })).ok).toBe(false);
  expect(close).not.toHaveBeenCalled();
  await tools.read_tab.execute({ tab: 3 });
  // A temporary Danger mode bypass must not become a permanent per-chat grant.
  expect(run.isAllowed(2)).toBe(false);
  expect(run.isAllowed(3)).toBe(false);
  const safe: any = createPageTools(run, {
    ...deps,
    dangerMode: false,
  });
  expect(
    await safe.click.needsApproval({ id: "e1" }, { toolCallId: "safe" }),
  ).toBe(true);
  expect(
    await safe.read_tab.needsApproval({ tab: 2 }, { toolCallId: "other" }),
  ).toBe(true);
  expect(
    await safe.read_tab.needsApproval({ tab: 3 }, { toolCallId: "read-other" }),
  ).toBe(true);
  const noTab: any = createPageTools(new RunContext(), deps);
  await expect(noTab.fill.execute({ id: "e1", text: "x" })).rejects.toThrow(
    "No tab to act on",
  );
});

it("only explicit danger mode adds the scoped prompt override", () => {
  expect(buildInstructions(null)).not.toContain("Danger mode is ON");
  const instructions = buildInstructions(null, [], undefined, undefined, true);
  expect(instructions).toContain("Danger mode is ON");
  expect(instructions).toContain(
    "File mutations, MCP writes and configuration changes retain their normal approvals",
  );
  expect(instructions).toContain(
    "not permission to bypass website authentication",
  );
});
