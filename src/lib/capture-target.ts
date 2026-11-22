import { browser } from "wxt/browser";
import type { ActivePage } from "./page-content";

export type CaptureTarget = NonNullable<ActivePage["captureTarget"]>;
export const CAPTURE_TARGET_CHANGED =
  "The starting page is no longer the active page. Return to it and ask again.";

export async function inCaptureDocument<T, A extends unknown[]>(
  target: CaptureTarget,
  func: (...args: A) => T,
  args: A,
): Promise<Awaited<T>> {
  const [result] = await browser.scripting.executeScript({
    target: { tabId: target.tabId, documentIds: [target.documentId] },
    func: func as any,
    args,
  });
  if (result?.documentId !== target.documentId || result.frameId !== 0)
    throw new Error(CAPTURE_TARGET_CHANGED);
  return result.result as Awaited<T>;
}

export async function verifyCaptureTarget(target: CaptureTarget) {
  try {
    if (!/^https?:\/\//i.test(target.url)) throw new Error();
    const [tab, window] = await Promise.all([
      browser.tabs.get(target.tabId),
      browser.windows.get(target.windowId),
    ]);
    if (
      !tab.active ||
      tab.incognito ||
      tab.windowId !== target.windowId ||
      tab.url !== target.url ||
      tab.pendingUrl ||
      !window.focused ||
      (await inCaptureDocument(target, () => location.href, [])) !== target.url
    )
      throw new Error();
  } catch {
    throw new Error(CAPTURE_TARGET_CHANGED);
  }
}

/** A focus/activation race can momentarily capture the wrong page even when
 * both tab queries agree. Invalidate on events for the entire acquisition. */
export function watchCaptureTarget(
  target: CaptureTarget,
  onChange?: () => void,
) {
  let changed = false,
    disposed = false;
  const invalidate = () => {
    if (changed) return;
    changed = true;
    onChange?.();
  };
  const activate = (event: { windowId: number; tabId: number }) => {
    if (event.windowId === target.windowId && event.tabId !== target.tabId)
      invalidate();
  };
  const focus = (id: number) => {
    if (id !== target.windowId) invalidate();
  };
  const update = (id: number, event: { status?: string; url?: string }) => {
    if (
      id === target.tabId &&
      (event.status === "loading" || event.url !== undefined)
    )
      invalidate();
  };
  const remove = (id: number) => {
    if (id === target.tabId) invalidate();
  };
  const replace = (_added: number, removed: number) => remove(removed);
  const { tabs, windows } = browser;
  tabs.onActivated.addListener(activate);
  tabs.onUpdated.addListener(update);
  tabs.onRemoved.addListener(remove);
  tabs.onDetached.addListener(remove);
  tabs.onReplaced.addListener(replace);
  windows.onFocusChanged.addListener(focus);
  const check = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (changed) throw new Error(CAPTURE_TARGET_CHANGED);
    await verifyCaptureTarget(target);
    signal?.throwIfAborted();
    if (changed) throw new Error(CAPTURE_TARGET_CHANGED);
  };
  return {
    check,
    async frame(signal?: AbortSignal) {
      await check(signal);
      let url: string;
      try {
        url = await tabs.captureVisibleTab(target.windowId, {
          format: "jpeg",
          quality: 85,
        });
      } catch {
        await check(signal);
        throw new Error(
          "Chrome could not capture the starting page. Try again from that page.",
        );
      }
      await check(signal);
      return url;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      tabs.onActivated.removeListener(activate);
      tabs.onUpdated.removeListener(update);
      tabs.onRemoved.removeListener(remove);
      tabs.onDetached.removeListener(remove);
      tabs.onReplaced.removeListener(replace);
      windows.onFocusChanged.removeListener(focus);
    },
  };
}

export async function captureStartingViewport(
  target: CaptureTarget,
  signal?: AbortSignal,
): Promise<string>;
export async function captureStartingViewport<T>(
  target: CaptureTarget,
  signal: AbortSignal | undefined,
  normalize: (url: string, signal?: AbortSignal) => Promise<T>,
): Promise<T>;
export async function captureStartingViewport<T>(
  target: CaptureTarget,
  signal?: AbortSignal,
  normalize?: (url: string, signal?: AbortSignal) => Promise<T>,
) {
  const watch = watchCaptureTarget(target);
  try {
    const url = await watch.frame(signal);
    if (!normalize) return url;
    const image = await normalize(url, signal);
    await watch.check(signal);
    return image;
  } finally {
    watch.dispose();
  }
}
