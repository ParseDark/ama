import { browser } from "wxt/browser";
import { getActiveTab, runInTab } from "./active-tab";
import {
  inCaptureDocument,
  watchCaptureTarget,
  type CaptureTarget,
} from "./capture-target";
import {
  decodeCapture,
  encodeCapture,
  type CaptureImage,
} from "./capture-image";
export const MAX_CAPTURE_HEIGHT = 12000;
export function planCapture(height: number, frameHeight: number) {
  height = Math.min(MAX_CAPTURE_HEIGHT, Math.max(1, height));
  frameHeight = Math.max(1, frameHeight);
  const offsets = [0];
  for (let y = frameHeight; y < height; y += frameHeight) {
    const next = Math.min(y, Math.max(0, height - frameHeight));
    if (next > offsets.at(-1)!) offsets.push(next);
    if (next === height - frameHeight) break;
  }
  return offsets;
}
export function stitchLayout(
  frameWidth: number,
  frameHeight: number,
  viewportWidth: number,
  height: number,
) {
  const ratio = frameWidth / viewportWidth,
    scale = Math.min(1, 1280 / frameWidth, 8000 / (height * ratio));
  return {
    ratio,
    scale,
    width: Math.round(frameWidth * scale),
    height: Math.round(height * ratio * scale),
    frameHeight: frameHeight * scale,
  };
}
function measureCapture() {
  return {
    width: innerWidth,
    height: innerHeight,
    total: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ),
    y: scrollY,
  };
}
function prepareCapture() {
  const root = document.documentElement;
  root.dataset.amaCapture = JSON.stringify({
    x: scrollX,
    y: scrollY,
    behavior: root.style.scrollBehavior,
  });
  root.style.scrollBehavior = "auto";
  scrollTo(0, 0);
  return {
    width: innerWidth,
    height: innerHeight,
    total: Math.min(
      12000,
      Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0),
    ),
  };
}
function scrollCapture(y: number, hide: boolean) {
  if (
    hide &&
    !document.documentElement.hasAttribute("data-ama-capture-hidden")
  ) {
    document.documentElement.setAttribute("data-ama-capture-hidden", "");
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      if (["fixed", "sticky"].includes(getComputedStyle(el).position)) {
        el.dataset.amaPrevVisibility = el.style.visibility;
        el.style.visibility = "hidden";
      }
    });
  }
  scrollTo(0, y);
  return scrollY;
}
function restoreCapture() {
  document
    .querySelectorAll<HTMLElement>("[data-ama-prev-visibility]")
    .forEach((el) => {
      el.style.visibility = el.dataset.amaPrevVisibility ?? "";
      delete el.dataset.amaPrevVisibility;
    });
  const root = document.documentElement;
  try {
    const s = JSON.parse(root.dataset.amaCapture ?? "{}");
    root.style.scrollBehavior = "auto";
    scrollTo(s.x ?? 0, s.y ?? 0);
    root.style.scrollBehavior = s.behavior ?? "";
  } finally {
    delete root.dataset.amaCapture;
    root.removeAttribute("data-ama-capture-hidden");
  }
}
export async function captureFullPage() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("No tab to capture.");
  return withFullPageLock(tab.id, () =>
    captureManualPage({ id: tab.id!, windowId: tab.windowId }),
  );
}
async function captureManualPage(tab: { id: number; windowId: number }) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let last = 0;
  const frames: { image: ImageBitmap; y: number }[] = [];
  try {
    const p = await runInTab(tab.id, prepareCapture, []);
    await wait(150);
    let offsets = [0];
    for (let i = 0; i < offsets.length; i++) {
      const y = await runInTab(tab.id, scrollCapture, [offsets[i], i > 0]);
      await wait(150);
      await wait(Math.max(0, 550 - (Date.now() - last)));
      if ((await getActiveTab())?.id !== tab.id)
        throw new Error(
          "The active tab changed during capture. Please try again.",
        );
      const url = await browser.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: 85,
      });
      last = Date.now();
      const image = await createImageBitmap(await (await fetch(url)).blob());
      frames.push({ image, y });
      if (i === 0)
        offsets = planCapture(
          p.total,
          Math.min(p.height, image.height / (image.width / p.width)),
        );
    }
    const l = stitchLayout(
      frames[0].image.width,
      frames[0].image.height,
      p.width,
      p.total,
    );
    const canvas = new OffscreenCanvas(l.width, l.height),
      ctx = canvas.getContext("2d")!;
    for (const f of frames) {
      ctx.drawImage(
        f.image,
        0,
        Math.round(f.y * l.ratio * l.scale),
        l.width,
        Math.round(f.image.height * l.scale),
      );
    }
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.85,
    });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } finally {
    for (const frame of frames) frame.image.close();
    await runInTab(tab.id, restoreCapture, []).catch(() => {});
  }
}

const scrollingTabs = new Set<number>();
async function withFullPageLock<T>(tabId: number, capture: () => Promise<T>) {
  if (scrollingTabs.has(tabId))
    throw new Error("A full-page capture is already running on this tab.");
  scrollingTabs.add(tabId);
  try {
    return await capture();
  } finally {
    scrollingTabs.delete(tabId);
  }
}

const MAX_FRAMES = 24;
const MAX_CAPTURE_MS = 18_000;
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function captureStartingFullPage(
  target: CaptureTarget,
  signal?: AbortSignal,
  {
    wait = delay,
    now = Date.now,
    decode = decodeCapture,
    encode = encodeCapture,
  } = {},
): Promise<CaptureImage> {
  return withFullPageLock(target.tabId, async () => {
    const watch = watchCaptureTarget(target);
    const frames: { image: ImageBitmap; y: number }[] = [];
    let startedScrolling = false;
    const started = now();
    let nextFrameAt = started;
    let width = 0,
      height = 0,
      covered = 0,
      total = 0;
    let unstable = false;
    try {
      await watch.check(signal);
      startedScrolling = true;
      await inCaptureDocument(target, prepareCapture, []);
      let offset = 0;
      while (frames.length < MAX_FRAMES && now() < started + MAX_CAPTURE_MS) {
        await watch.check(signal);
        await inCaptureDocument(target, scrollCapture, [
          offset,
          frames.length > 0,
        ]);
        await wait(Math.max(150, nextFrameAt - now()));
        await watch.check(signal);
        if (now() >= started + MAX_CAPTURE_MS) break;
        const before = await inCaptureDocument(target, measureCapture, []);
        total = before.total;
        if (!frames.length) {
          width = before.width;
          height = before.height;
        }
        if (
          before.width !== width ||
          before.height !== height ||
          width < 1 ||
          height < 1 ||
          before.y > covered ||
          (frames.length && before.y + height <= covered)
        ) {
          unstable = true;
          break;
        }
        const url = await watch.frame(signal);
        nextFrameAt = now() + 550;
        const after = await inCaptureDocument(target, measureCapture, []);
        total = after.total;
        if (
          after.y !== before.y ||
          after.width !== width ||
          after.height !== height
        ) {
          unstable = true;
          break;
        }
        const image = await decode(url);
        frames.push({ image, y: before.y });
        covered = Math.min(MAX_CAPTURE_HEIGHT, before.y + height);
        if (covered >= Math.min(total, MAX_CAPTURE_HEIGHT)) break;
        offset =
          planCapture(total, height).find(
            (y) => y > before.y && y + height > covered,
          ) ?? covered;
      }
      await watch.check(signal);
      if (!frames.length || !covered)
        throw new Error("No stable full-page image could be captured.");
      const first = frames[0]!.image;
      const l = stitchLayout(first.width, first.height, width, covered);
      const canvas = new OffscreenCanvas(
        Math.max(1, l.width),
        Math.max(1, l.height),
      );
      const ctx = canvas.getContext("2d")!;
      for (const { image, y } of frames) {
        ctx.drawImage(
          image,
          0,
          Math.round(y * l.ratio * l.scale),
          canvas.width,
          l.frameHeight,
        );
      }
      const image = await encode(canvas, signal);
      const final = await inCaptureDocument(target, measureCapture, []);
      total = final.total;
      await watch.check(signal);
      return {
        ...image,
        coverage: {
          start: 0,
          end: Math.min(covered, total),
          total,
          partial:
            unstable ||
            covered < total ||
            final.width !== width ||
            final.height !== height,
        },
      };
    } finally {
      try {
        if (startedScrolling) {
          try {
            await inCaptureDocument(target, restoreCapture, []);
          } catch {
            await watch.check(signal);
            throw new Error(
              "Could not restore the page after full-page capture.",
            );
          }
        }
        // Changes during scroll restoration still invalidate the image.
        await watch.check(signal);
      } finally {
        frames.forEach(({ image }) => image.close());
        watch.dispose();
      }
    }
  });
}
