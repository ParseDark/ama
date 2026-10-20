import { it, expect, vi } from "vitest";
import { RunContexts } from "@/lib/run-context";
const page = (tabId: number) => ({
  tabId,
  title: "Page",
  url: "https://example.com",
  markdown: "content",
  selection: "",
  truncated: false,
  elements: [],
});
it("resumes on start tab but moves for new user messages preserving rights", async () => {
  const active = vi
      .fn()
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce(page(2)),
    read = vi.fn(async (id) => page(id));
  const contexts = new RunContexts(active, read);
  const { run } = await contexts.forRequest("chat", [
    { id: "u", role: "user", parts: [] },
  ]);
  run.own(3);
  run.approve(4);
  const resume = await contexts.forRequest("chat", [
    { id: "a", role: "assistant", parts: [] },
  ]);
  expect(resume.page?.tabId).toBe(1);
  expect(active).toHaveBeenCalledOnce();
  const next = await contexts.forRequest("chat", [
    { id: "u2", role: "user", parts: [] },
  ]);
  expect(next.run.startTabId).toBe(2);
  expect(next.run.owns(3)).toBe(true);
  expect(next.run.isAllowed(4)).toBe(true);
  expect(next.run.isAllowed(1)).toBe(false);
});
