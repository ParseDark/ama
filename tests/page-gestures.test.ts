import { afterEach, expect, it, vi } from "vitest";
import {
  scrollPage,
  doubleClickElement,
  dragElement,
} from "@/lib/page-gestures";

const box = (left = 10) => ({
  left,
  top: 10,
  right: left + 40,
  bottom: 50,
  width: 40,
  height: 40,
  x: left,
  y: 10,
  toJSON() {},
});
function endpoints(draggable = false) {
  // happy-dom's DragEvent currently drops DragEventInit.dataTransfer.
  vi.stubGlobal(
    "DragEvent",
    class extends MouseEvent {
      readonly dataTransfer: DataTransfer | null;
      constructor(type: string, init: DragEventInit = {}) {
        super(type, init);
        this.dataTransfer = init.dataTransfer ?? null;
      }
    },
  );
  document.body.innerHTML = `<div data-ama-id="a" draggable="${draggable}">Source</div><div data-ama-id="b">Target</div>`;
  const source = document.querySelector<HTMLElement>('[data-ama-id="a"]')!;
  const target = document.querySelector<HTMLElement>('[data-ama-id="b"]')!;
  // happy-dom does not reflect the draggable HTML attribute.
  source.draggable = draggable;
  for (const [el, left] of [
    [source, 10],
    [target, 110],
  ] as const) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(box(left));
    vi.spyOn(el, "checkVisibility").mockReturnValue(true);
    vi.spyOn(el, "scrollIntoView").mockImplementation(() => {});
  }
  vi.spyOn(document, "elementFromPoint").mockImplementation((x) =>
    x < 80 ? source : target,
  );
  return { source, target };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("scrolls the nearest container and reports actual movement and boundaries", async () => {
  endpoints();
  const outer = document.createElement("div");
  outer.style.overflowY = "auto";
  outer.append(document.querySelector('[data-ama-id="a"]')!);
  document.body.append(outer);
  Object.defineProperties(outer, {
    scrollHeight: { value: 600 },
    clientHeight: { value: 100 },
  });
  vi.spyOn(outer, "scrollBy").mockImplementation((options: any) => {
    outer.scrollTop = Math.min(500, outer.scrollTop + options.top);
  });
  expect(await scrollPage("a", 0, 900)).toMatchObject({
    ok: true,
    before: { y: 0 },
    after: { y: 500 },
    moved: true,
    atBoundary: { y: true, x: null },
  });
  expect(await scrollPage("a", 0, 900)).toMatchObject({ moved: false });
  expect(await scrollPage("missing", 0, 10)).toMatchObject({ ok: false });
  expect(await scrollPage("a", 0, 0)).toMatchObject({ ok: false });
  expect(await scrollPage("a", NaN, 1)).toMatchObject({ ok: false });
  expect(await scrollPage("a", 0, 10001)).toMatchObject({ ok: false });
  expect(await scrollPage("b", 0, 10)).toMatchObject({ ok: false });
});

it("dispatches two click sequences and one dblclick with truthful result", () => {
  const { source } = endpoints();
  const events: string[] = [];
  for (const name of [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
    "dblclick",
  ])
    source.addEventListener(name, (e) =>
      events.push(`${name}:${(e as MouseEvent).detail}`),
    );
  expect(doubleClickElement("a")).toMatchObject({
    ok: true,
    dispatched: true,
    verified: false,
  });
  expect(events).toEqual([
    "pointerdown:1",
    "mousedown:1",
    "pointerup:1",
    "mouseup:1",
    "click:1",
    "pointerdown:2",
    "mousedown:2",
    "pointerup:2",
    "mouseup:2",
    "click:2",
    "dblclick:2",
  ]);
});

it("refuses disabled, covered, missing or stale double-click targets", () => {
  const { source, target } = endpoints();
  expect(doubleClickElement("missing").ok).toBe(false);
  source.setAttribute("aria-disabled", "true");
  expect(doubleClickElement("a").ok).toBe(false);
  source.removeAttribute("aria-disabled");
  vi.mocked(document.elementFromPoint).mockReturnValue(target);
  expect(doubleClickElement("a").ok).toBe(false);
  vi.mocked(document.elementFromPoint).mockReturnValue(source);
  source.addEventListener("click", () => source.remove());
  expect(doubleClickElement("a")).toMatchObject({ ok: false, partial: true });
});

it("dispatches an accepted HTML5 drag with shared DataTransfer and cleanup", async () => {
  const { source, target } = endpoints(true);
  const events: string[] = [];
  source.addEventListener("dragstart", (e) => {
    events.push("start");
    (e as DragEvent).dataTransfer!.setData("text/plain", "payload");
  });
  target.addEventListener("dragover", (e) => e.preventDefault());
  target.addEventListener("drop", (e) =>
    events.push((e as DragEvent).dataTransfer!.getData("text/plain")),
  );
  source.addEventListener("dragend", () => events.push("end"));
  expect(await dragElement("a", "b")).toMatchObject({
    ok: true,
    mode: "html5",
    verified: false,
  });
  expect(events).toEqual(["start", "payload", "end"]);
});

it("does not send a drop unless dragover was accepted; cancelled starts still clean up", async () => {
  const { source, target } = endpoints(true);
  const drop = vi.fn(),
    end = vi.fn();
  target.addEventListener("drop", drop);
  source.addEventListener("dragend", end);
  expect(await dragElement("a", "b")).toMatchObject({ ok: false });
  expect(drop).not.toHaveBeenCalled();
  source.addEventListener("dragstart", (e) => e.preventDefault());
  expect(await dragElement("a", "b")).toMatchObject({
    ok: false,
    error: "The page cancelled dragstart.",
  });
  expect(end).toHaveBeenCalledTimes(2);
});

it("dispatches pointer movement with pressed buttons and releases on stale endpoint", async () => {
  const { source, target } = endpoints();
  const move = vi.fn(),
    up = vi.fn();
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  try {
    expect(await dragElement("a", "b")).toMatchObject({
      ok: true,
      mode: "pointer",
      verified: false,
    });
    expect(move).toHaveBeenCalledTimes(12);
    expect(move.mock.calls[0][0].buttons).toBe(1);
    expect(up.mock.calls[0][0].buttons).toBe(0);
    source.addEventListener("pointerdown", () => target.remove());
    expect(await dragElement("a", "b")).toMatchObject({
      ok: false,
      partial: true,
    });
    expect(up).toHaveBeenCalledTimes(2);
  } finally {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
  }
});

it("refuses same, missing and offscreen drag endpoints without starting", async () => {
  const { source, target } = endpoints();
  const down = vi.fn();
  source.addEventListener("pointerdown", down);
  expect((await dragElement("a", "a")).ok).toBe(false);
  expect((await dragElement("a", "missing")).ok).toBe(false);
  vi.mocked(target.getBoundingClientRect).mockReturnValue(box(100000));
  expect((await dragElement("a", "b")).ok).toBe(false);
  expect(down).not.toHaveBeenCalled();
});
