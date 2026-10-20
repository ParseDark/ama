import { browser } from "wxt/browser";
import type { ActivePage, PageContent } from "./page-content";
export async function getActiveTab() {
  return (
    (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0] ??
    null
  );
}
export async function readTabPage(tabId: number): Promise<ActivePage | null> {
  try {
    const r = await browser.scripting.executeScript({
      target: { tabId },
      files: ["/extract.js"],
    });
    const p = r[0]?.result as PageContent | undefined;
    return p ? { ...p, tabId } : null;
  } catch {
    return null;
  }
}
export async function readActivePage() {
  const tab = await getActiveTab();
  return tab?.id ? readTabPage(tab.id) : null;
}
export async function runInTab<T, A extends unknown[]>(
  tabId: number,
  func: (...args: A) => T,
  args: A,
): Promise<Awaited<T>> {
  const r = await browser.scripting.executeScript({
    target: { tabId },
    func: func as any,
    args,
  });
  if (!r[0]) throw new Error("The page could not be accessed.");
  return r[0].result as Awaited<T>;
}
export async function captureActiveTab() {
  const t = await getActiveTab();
  if (!t) throw new Error("No active tab.");
  try {
    return await browser.tabs.captureVisibleTab(t.windowId, {
      format: "jpeg",
      quality: 85,
    });
  } catch (e) {
    throw new Error(
      `Can't capture ${t.url}: ${e instanceof Error ? e.message : e}`,
    );
  }
}
