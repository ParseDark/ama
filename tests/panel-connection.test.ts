import { it, expect, vi } from "vitest";
import { PanelTracker } from "@/lib/panel-connection";
import { panelShortcut } from "@/lib/shortcuts";
it("counts overlapping ports and toggles synchronously", () => {
  const t = new PanelTracker(),
    a = { postMessage: vi.fn() },
    b = { postMessage: vi.fn() },
    api = { open: vi.fn(), close: vi.fn() };
  t.toggle(1, api);
  expect(api.open).toHaveBeenCalledWith({ windowId: 1 });
  const remove = t.add(1, a);
  t.add(1, b);
  remove();
  expect(t.count(1)).toBe(1);
  t.toggle(1, api);
  expect(api.close).toHaveBeenCalledOnce();
  t.clear(1);
  expect(b.postMessage).toHaveBeenCalledWith({ type: "ama:clear-chat" });
});
it("closes only for Control+K, leaving Command+K and modified chords alone", () => {
  const e = {
    code: "KeyK",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
  expect(panelShortcut(e)).toBe("close");
  expect(panelShortcut({ ...e, ctrlKey: false, metaKey: true })).toBeNull();
  expect(panelShortcut({ ...e, metaKey: true })).toBeNull();
  expect(panelShortcut({ ...e, altKey: true })).toBeNull();
  expect(panelShortcut({ ...e, shiftKey: true })).toBeNull();
});
it("uses physical L code for Option-shift including macOS Ò", () => {
  const e = {
    code: "KeyL",
    metaKey: false,
    ctrlKey: false,
    altKey: true,
    shiftKey: true,
  };
  expect(panelShortcut(e)).toBe("clear");
  expect(
    panelShortcut({ ...e, altKey: false, metaKey: true, shiftKey: false }),
  ).toBeNull();
  expect(
    panelShortcut({
      ...e,
      code: "KeyK",
      altKey: false,
      ctrlKey: true,
      shiftKey: false,
    }),
  ).toBe("close");
});
