import { browser } from "wxt/browser";
export class PanelTracker {
  private ports = new Map<number, Set<any>>();
  add(windowId: number, port: any) {
    const set = this.ports.get(windowId) ?? new Set();
    set.add(port);
    this.ports.set(windowId, set);
    return () => {
      set.delete(port);
      if (!set.size) this.ports.delete(windowId);
    };
  }
  count(windowId: number) {
    return this.ports.get(windowId)?.size ?? 0;
  }
  toggle(
    windowId: number,
    sidePanel: {
      open: (v: { windowId: number }) => unknown;
      close: (v: { windowId: number }) => unknown;
    } = browser.sidePanel as any,
  ) {
    return this.count(windowId)
      ? sidePanel.close({ windowId })
      : sidePanel.open({ windowId });
  }
  clear(windowId: number) {
    for (const port of this.ports.get(windowId) ?? [])
      port.postMessage({ type: "ama:clear-chat" });
  }
}
export async function connectPanel() {
  const w = await browser.windows.getCurrent();
  let closed = false,
    port: ReturnType<typeof browser.runtime.connect> | undefined,
    timer: ReturnType<typeof setInterval>,
    retry: ReturnType<typeof setTimeout>;
  const connect = () => {
    if (closed) return;
    port = browser.runtime.connect({ name: `sidepanel:${w.id}` });
    port.onMessage.addListener((m) => {
      if (m.type === "ama:clear-chat")
        window.dispatchEvent(new Event("ama:clear-chat"));
    });
    timer = setInterval(() => {
      try {
        port?.postMessage({ type: "ping" });
      } catch {}
    }, 20000);
    port.onDisconnect.addListener(() => {
      clearInterval(timer);
      if (!closed) retry = setTimeout(connect, 500);
    });
  };
  connect();
  return () => {
    closed = true;
    clearInterval(timer);
    clearTimeout(retry);
    port?.disconnect();
  };
}
