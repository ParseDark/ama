import { browser } from "wxt/browser";
import { NetworkCapture } from "./capture";

export function initNetworkCapture() {
  const service = new NetworkCapture({
    attach: async (tabId) => {
      await browser.debugger.attach({ tabId }, "1.3");
    },
    detach: async (tabId) => {
      await browser.debugger.detach({ tabId });
    },
    command: async (tabId, method, params) =>
      browser.debugger.sendCommand({ tabId }, method, params),
    resolveTab: async (id) => {
      const tab =
        id === undefined
          ? (await browser.tabs.query({ active: true, currentWindow: true }))[0]
          : await browser.tabs.get(id);
      if (!tab || tab.id === undefined || !tab.url)
        throw new Error("No eligible tab");
      return { id: tab.id, url: tab.url };
    },
    notify: (status) => {
      void browser.runtime
        .sendMessage({ type: "network-capture-status", status })
        .catch(() => {});
    },
  });
  browser.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId !== undefined)
      service.event(source.tabId, method, params || {});
  });
  browser.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId !== undefined) service.detached(source.tabId, reason);
  });
  browser.tabs.onRemoved.addListener((tabId) =>
    service.detached(tabId, "tab_closed"),
  );
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "network-capture") return;
    const expected = browser.runtime.getURL("/sidepanel.html");
    if (
      sender.id !== browser.runtime.id ||
      sender.url?.split(/[?#]/)[0] !== expected
    ) {
      sendResponse({ ok: false, error: "Unauthorized" });
      return;
    }
    if (
      typeof message.sessionId !== "string" ||
      !message.sessionId ||
      message.sessionId.length > 256 ||
      (message.tabId !== undefined &&
        (!Number.isInteger(message.tabId) || message.tabId < 0))
    ) {
      sendResponse({ ok: false, error: "Invalid request" });
      return;
    }
    const task =
      message.action === "start"
        ? service.start(message.sessionId, message.tabId)
        : message.action === "stop"
          ? service.stop(message.sessionId)
          : message.action === "clear"
            ? service.clear(message.sessionId)
            : message.action === "status"
              ? Promise.resolve().then(() => service.status(message.sessionId))
              : Promise.reject(new Error("Invalid action"));
    void task.then(
      (value) => sendResponse({ ok: true, value }),
      (error) => sendResponse({ ok: false, error: error.message }),
    );
    return true;
  });
  return service;
}
