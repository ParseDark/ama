import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getAll: vi.fn(),
  create: vi.fn(async () => ({})),
}));
vi.mock("wxt/browser", () => ({
  browser: {
    commands: { getAll: state.getAll },
    tabs: { create: state.create },
  },
}));
import { ShortcutSettings } from "@/components/shortcut-settings";

async function render() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(<ShortcutSettings />));
  return { node, root };
}

it("shows Chrome's real binding, opens shortcut settings and reports read failures", async () => {
  state.getAll.mockResolvedValue([
    { name: "toggle-panel", shortcut: "Command+Shift+Y" },
  ]);
  const { node, root } = await render();
  expect(node.textContent).toContain("Command+Shift+Y");
  await act(async () => {
    node.querySelector("button")!.click();
  });
  expect(state.create).toHaveBeenCalledWith({
    url: "chrome://extensions/shortcuts",
  });
  await act(async () => root.unmount());
  node.remove();
});

it("treats an unassigned suggestion as no binding instead of claiming success", async () => {
  state.getAll.mockResolvedValue([{ name: "toggle-panel", shortcut: "" }]);
  const { node, root } = await render();
  expect(node.textContent).toContain("Not assigned");
  await act(async () => root.unmount());
  node.remove();
});
