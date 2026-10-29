import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { NetworkCapture } from "@/components/network-capture";
import { ToolPart } from "@/components/tool-parts";

const client = vi.hoisted(() => ({
  status: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/lib/network/client", () => ({ networkClient: client }));
vi.mock("@/hooks/use-active-tab", () => ({
  useActiveTab: () => ({ title: "Example page" }),
}));
const stopped = {
  captureId: null,
  tabId: null,
  state: "stopped",
  count: 0,
  limitReached: false,
  droppedCount: 0,
};

it("reconnects, starts only on demand, refreshes on push and never stops on rerender/unmount", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  client.status.mockReset().mockResolvedValue(stopped);
  client.start.mockReset().mockResolvedValue({});
  client.stop.mockReset();
  const node = document.createElement("div");
  const root = createRoot(node);
  await act(async () => root.render(<NetworkCapture sessionId="chat-a" />));
  expect(node.textContent).toContain("URLs and bodies may contain sensitive");
  expect(client.start).not.toHaveBeenCalled();
  await act(async () => root.render(<NetworkCapture sessionId="chat-a" />));
  expect(client.status).toHaveBeenCalledTimes(1);
  client.status.mockResolvedValue({
    ...stopped,
    state: "capturing",
    tabId: 7,
    count: 200,
    limitReached: true,
    droppedCount: 3,
  });
  await act(async () => {
    node.querySelector("button")!.click();
  });
  expect(client.start).toHaveBeenCalledWith("chat-a");
  expect(node.textContent).toContain("Tab 7");
  expect(node.textContent).toContain("3 dropped");
  client.status.mockResolvedValue({ ...stopped, reason: "debugger_detached" });
  await act(async () => {
    await browser.runtime.sendMessage({
      type: "network-capture-status",
      status: { tabId: 999 },
    });
  });
  expect(node.textContent).toContain("debugger_detached");
  expect(node.textContent).not.toContain("999");
  await act(async () => root.unmount());
  expect(client.stop).not.toHaveBeenCalled();
});

it("shows the network-specific approval and sends the decision", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const node = document.createElement("div"),
    root = createRoot(node),
    onApproval = vi.fn();
  await act(async () =>
    root.render(
      <ToolPart
        part={{
          type: "tool-capture_network_start",
          state: "approval-requested",
          approval: { id: "approval" },
          toolCallId: "call",
        }}
        onApproval={onApproval}
      />,
    ),
  );
  expect(node.textContent).toContain("Example page");
  expect(node.textContent).toContain(
    "Headers, URLs and bodies may contain sensitive information and are not redacted.",
  );
  expect(node.textContent).toContain("preview may be sent");
  await act(async () => {
    [...node.querySelectorAll("button")]
      .find((b) => b.textContent === "Deny")!
      .click();
  });
  expect(onApproval).toHaveBeenCalledWith({ id: "approval", approved: false });
  await act(async () => root.unmount());
});
