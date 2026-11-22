import { beforeEach, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { readActivePage } from "@/lib/active-tab";
import { captureStartingViewport } from "@/lib/capture-target";
import {
  captureFullPage,
  captureStartingFullPage,
} from "@/lib/full-page-capture";
import { MAX_CAPTURE_BYTES, normalizeViewport } from "@/lib/capture-image";

vi.mock("wxt/browser", () => {
  const event = () => {
    const callbacks = new Set<(...args: any[]) => void>();
    return {
      addListener: (fn: (...args: any[]) => void) => callbacks.add(fn),
      removeListener: (fn: (...args: any[]) => void) => callbacks.delete(fn),
      emit: (...args: any[]) => callbacks.forEach((fn) => fn(...args)),
      size: () => callbacks.size,
    };
  };
  return {
    browser: {
      tabs: {
        get: vi.fn(),
        query: vi.fn(),
        captureVisibleTab: vi.fn(),
        onActivated: event(),
        onUpdated: event(),
        onRemoved: event(),
        onDetached: event(),
        onReplaced: event(),
      },
      windows: { get: vi.fn(), onFocusChanged: event() },
      scripting: { executeScript: vi.fn() },
    },
  };
});
const b = browser as any;
const target = {
  tabId: 1,
  windowId: 2,
  documentId: "doc-a",
  url: "https://example.test/",
};
const tab = {
  id: 1,
  windowId: 2,
  active: true,
  incognito: false,
  url: target.url,
};
const listeners = () =>
  [
    b.tabs.onActivated,
    b.tabs.onUpdated,
    b.tabs.onRemoved,
    b.tabs.onDetached,
    b.tabs.onReplaced,
    b.windows.onFocusChanged,
  ].map((e) => e.size());
beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  b.tabs.get.mockResolvedValue(tab);
  b.windows.get.mockResolvedValue({ focused: true });
  b.scripting.executeScript.mockResolvedValue([
    { documentId: "doc-a", frameId: 0, result: tab.url },
  ]);
  b.tabs.captureVisibleTab.mockResolvedValue("data:image/jpeg;base64,test");
});

it("binds the active page's starting document and window", async () => {
  b.tabs.query.mockResolvedValue([tab]);
  b.scripting.executeScript.mockResolvedValue([
    { documentId: "doc-a", frameId: 0, result: { url: tab.url } },
  ]);
  expect((await readActivePage())?.captureTarget).toEqual(target);
  b.tabs.query.mockResolvedValue([{ ...tab, incognito: true }]);
  expect((await readActivePage())?.captureTarget).toBeUndefined();
});

it("captures only the pinned active page, then releases all listeners", async () => {
  expect(await captureStartingViewport(target)).toBe(
    "data:image/jpeg;base64,test",
  );
  expect(b.tabs.captureVisibleTab).toHaveBeenCalledWith(2, {
    format: "jpeg",
    quality: 85,
  });
  expect(b.scripting.executeScript).toHaveBeenCalledWith(
    expect.objectContaining({ target: { tabId: 1, documentIds: ["doc-a"] } }),
  );
  expect(listeners()).toEqual([0, 0, 0, 0, 0, 0]);
});

it.each([
  "closed",
  "another window",
  "same URL reload",
  "incognito",
  "internal",
])("rejects %s without taking a shot", async (reason) => {
  if (reason === "closed") b.tabs.get.mockRejectedValue(new Error());
  if (reason === "another window")
    b.windows.get.mockResolvedValue({ focused: false });
  if (reason === "same URL reload")
    b.scripting.executeScript.mockResolvedValue([
      { documentId: "doc-b", frameId: 0, result: tab.url },
    ]);
  if (reason === "incognito")
    b.tabs.get.mockResolvedValue({ ...tab, incognito: true });
  await expect(
    captureStartingViewport(
      reason === "internal" ? { ...target, url: "chrome://settings" } : target,
    ),
  ).rejects.toThrow("starting page");
  expect(b.tabs.captureVisibleTab).not.toHaveBeenCalled();
  expect(listeners()).toEqual([0, 0, 0, 0, 0, 0]);
});

it("discards the result even if another tab was active only during capture", async () => {
  b.tabs.captureVisibleTab.mockImplementation(async () => {
    b.tabs.onActivated.emit({ windowId: 2, tabId: 99 });
    b.tabs.onActivated.emit({ windowId: 2, tabId: 1 });
    return "private image";
  });
  await expect(captureStartingViewport(target)).rejects.toThrow(
    "starting page",
  );
  expect(listeners()).toEqual([0, 0, 0, 0, 0, 0]);
});

function mockFullPage(total = 1700, height = 600) {
  let y = 200,
    clock = 0,
    styled = false;
  const frames = vi.fn();
  const close = vi.fn();
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage: frames };
      }
    },
  );
  b.tabs.query.mockResolvedValue([tab]);
  b.scripting.executeScript.mockImplementation(async (details: any) => {
    expect(details.target.documentIds).toEqual(["doc-a"]);
    let result: unknown = tab.url;
    if (details.func.name === "prepareCapture") {
      y = 0;
      styled = true;
    }
    if (details.func.name === "scrollCapture")
      y = Math.min(details.args[0], total - height);
    if (details.func.name === "measureCapture")
      result = { width: 640, height, total, y };
    if (details.func.name === "restoreCapture") {
      y = 200;
      styled = false;
    }
    return [{ documentId: "doc-a", frameId: 0, result }];
  });
  return {
    frames,
    close,
    state: () => ({ y, styled }),
    deps: {
      now: () => clock,
      wait: async (ms: number) => {
        clock += ms;
      },
      decode: async () =>
        ({ width: 1280, height: height * 2, close }) as unknown as ImageBitmap,
      encode: async (canvas: OffscreenCanvas) => ({
        bytes: new Uint8Array([1]),
        width: canvas.width,
        height: canvas.height,
      }),
    },
  };
}

it("stitches below-the-fold frames and restores the document", async () => {
  const { deps, state, frames, close } = mockFullPage();
  const image = await captureStartingFullPage(target, undefined, deps);
  expect(image.coverage).toEqual({
    start: 0,
    end: 1700,
    total: 1700,
    partial: false,
  });
  expect(frames.mock.calls.map((args) => args[2])).toEqual([0, 1200, 2200]);
  expect(close).toHaveBeenCalledTimes(3);
  expect(state()).toEqual({ y: 200, styled: false });
  expect(listeners()).toEqual([0, 0, 0, 0, 0, 0]);
});

it.each([
  [600, 12000, 20],
  [200, 4800, 24],
  [1800, 1800, 1],
])(
  "bounds full-page coverage with a %i pixel viewport",
  async (height, covered, count) => {
    const { deps } = mockFullPage(30000, height);
    if (height === 1800) {
      const wait = deps.wait;
      let calls = 0;
      deps.wait = (ms) => wait(++calls === 2 ? 18000 : ms);
    }
    const image = await captureStartingFullPage(target, undefined, deps);
    expect(image.coverage).toEqual({
      start: 0,
      end: covered,
      total: 30000,
      partial: true,
    });
    expect(image.width).toBeLessThanOrEqual(1280);
    expect(image.height).toBeLessThanOrEqual(8000);
    expect(b.tabs.captureVisibleTab).toHaveBeenCalledTimes(count);
  },
);

it.each(["abort", "switch", "navigation"])(
  "invalidates a full-page run on %s and only restores the original document",
  async (kind) => {
    const { deps, state, close } = mockFullPage();
    const controller = new AbortController();
    b.tabs.captureVisibleTab
      .mockResolvedValueOnce("first frame")
      .mockImplementation(async () => {
        if (kind === "abort") controller.abort();
        else if (kind === "switch")
          b.tabs.onActivated.emit({ windowId: 2, tabId: 99 });
        else b.tabs.onUpdated.emit(1, { status: "loading" });
        return "discard this frame";
      });
    await expect(
      captureStartingFullPage(target, controller.signal, deps),
    ).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
    expect(b.scripting.executeScript.mock.calls.at(-1)[0].func.name).toBe(
      "restoreCapture",
    );
    expect(state()).toEqual({ y: 200, styled: false });
    expect(listeners()).toEqual([0, 0, 0, 0, 0, 0]);
  },
);

it("does not let the manual capture mutate a document already being captured", async () => {
  const { deps } = mockFullPage();
  const active = captureStartingFullPage(target, undefined, deps);
  await expect(captureFullPage()).rejects.toThrow("already running");
  await expect(active).resolves.toBeDefined();
});

it("normalizes viewport JPEG and downsizes a payload above the byte limit", async () => {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", async () => ({
    width: 3200,
    height: 1800,
    close,
  }));
  const output = vi
    .fn()
    .mockResolvedValueOnce(
      new Blob([new Uint8Array(MAX_CAPTURE_BYTES + 1)], { type: "image/jpeg" }),
    )
    .mockResolvedValue(new Blob([new Uint8Array([1])], { type: "image/jpeg" }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      convertToBlob = output;
      getContext() {
        return { drawImage: vi.fn() };
      }
    },
  );
  const image = await normalizeViewport("data:image/jpeg;base64,AA==");
  expect(image).toEqual({
    width: 1600,
    height: 900,
    bytes: new Uint8Array([1]),
  });
  expect(output).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledOnce();
});

it("discards the result after cancellation and removes listeners", async () => {
  const controller = new AbortController();
  b.tabs.captureVisibleTab.mockImplementation(async () => {
    controller.abort();
    return "canceled image";
  });
  await expect(
    captureStartingViewport(target, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(listeners()).toEqual([0, 0, 0, 0, 0, 0]);
});
