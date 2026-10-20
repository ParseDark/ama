import { browser } from "wxt/browser";
import { getActiveTab, runInTab } from "./active-tab";
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
