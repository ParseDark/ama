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
it.each(["MacIntel", "Win32", "Linux x86_64"])(
  "uses the platform toggle modifier on %s and rejects modified chords",
  (platform) => {
    const e = {
      code: "KeyK",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    const mac = platform === "MacIntel";
    const chord = { ...e, ctrlKey: !mac, metaKey: mac };
    expect(panelShortcut(chord, platform)).toBe("close");
    expect(
      panelShortcut({ ...chord, ctrlKey: mac, metaKey: !mac }, platform),
    ).toBeNull();
    expect(
      panelShortcut({ ...chord, ctrlKey: true, metaKey: true }, platform),
    ).toBeNull();
    expect(panelShortcut({ ...chord, altKey: true }, platform)).toBeNull();
    expect(panelShortcut({ ...chord, shiftKey: true }, platform)).toBeNull();
    expect(
      panelShortcut({ ...chord, ctrlKey: false, metaKey: false }, platform),
    ).toBeNull();
  },
);
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
    panelShortcut(
      {
        ...e,
        code: "KeyK",
        altKey: false,
        ctrlKey: true,
        shiftKey: false,
      },
      "Win32",
    ),
  ).toBe("close");
});
