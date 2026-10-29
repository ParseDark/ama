import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { Browser } from "wxt/browser";
import { initNetworkCapture } from "@/lib/network/background";

beforeEach(() => {
  vi.spyOn(fakeBrowser.debugger.onEvent, "addListener").mockImplementation(
    () => {},
  );
  vi.spyOn(fakeBrowser.debugger.onDetach, "addListener").mockImplementation(
    () => {},
  );
  initNetworkCapture();
});

async function send(sender: Browser.runtime.MessageSender, action = "status") {
  const respond = vi.fn();
  const results = await fakeBrowser.runtime.onMessage.trigger(
    { type: "network-capture", action, sessionId: "session" },
    sender,
    respond,
  );
  await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
  return { result: results[0], response: respond.mock.calls[0][0] };
}

describe("network capture message authorization", () => {
  it.each([false, true])(
    "accepts the sidepanel with tab=%s",
    async (withTab) => {
      const url = fakeBrowser.runtime.getURL("/sidepanel.html");
      const sender: Browser.runtime.MessageSender = {
        id: fakeBrowser.runtime.id,
        url,
        ...(withTab ? { tab: { id: 1, url } as Browser.tabs.Tab } : {}),
      };
      for (const action of ["status", "clear"]) {
        const { result, response } = await send(sender, action);
        expect(result).toBe(true);
        expect(response.ok).toBe(true);
      }
    },
  );

  it.each([
    { id: "test-extension-id", url: "https://example.com/sidepanel.html" },
    {
      id: "test-extension-id",
      url: "chrome-extension://test-extension-id/options.html",
    },
    {
      id: "other-extension",
      url: "chrome-extension://test-extension-id/sidepanel.html",
    },
    {
      id: "test-extension-id",
      url: "chrome-extension://other-extension/sidepanel.html",
    },
    {
      id: "test-extension-id",
      url: "chrome-extension://test-extension-id/sidepanel.html.evil",
    },
    { id: "test-extension-id" },
  ])("rejects unauthorized sender $url", async (sender) => {
    const { response } = await send({
      ...sender,
      tab: { id: 1 } as Browser.tabs.Tab,
    });
    expect(response).toEqual({ ok: false, error: "Unauthorized" });
  });
});
