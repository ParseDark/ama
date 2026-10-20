import { browser } from "wxt/browser";
import { webURL } from "./url";
export async function getTab(id: number) {
  try {
    return await browser.tabs.get(id);
  } catch {
    return null;
  }
}
export async function listTabs(windowId?: number) {
  return browser.tabs.query(windowId === undefined ? {} : { windowId });
}
export async function openTab(url: string, nearTabId?: number) {
  const near = nearTabId ? await getTab(nearTabId) : null;
  const tab = await browser.tabs.create({
    url: webURL(url),
    active: false,
    ...(near
      ? { windowId: near.windowId, index: near.index + 1, openerTabId: near.id }
      : {}),
  });
  if (!tab.id) throw new Error("Could not open tab.");
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id: number, change: { status?: string }) => {
      if (id === tab.id && change.status === "complete") finish();
    };
    const timer = setTimeout(finish, 15000);
    browser.tabs.onUpdated.addListener(listener);
    void getTab(tab.id!).then((t) => {
      if (!t || t.status === "complete") finish();
    });
  });
  await new Promise((r) => setTimeout(r, 500));
  return (await getTab(tab.id)) ?? tab;
}
export const switchTab = (id: number) =>
  browser.tabs.update(id, { active: true });
export const closeTab = (id: number) => browser.tabs.remove(id);
