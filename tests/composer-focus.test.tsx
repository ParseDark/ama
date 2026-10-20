import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useComposerFocus } from "@/hooks/use-composer-focus";

it("focuses on entering chat, cancels when hidden and preserves control focus on resume", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let sequence = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++sequence, fn);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flush = () => {
    for (const [id, fn] of [...frames]) {
      frames.delete(id);
      fn(0);
    }
  };
  function Composer({ active }: { active: boolean }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useComposerFocus(ref, active);
    return (
      <>
        <div hidden={!active}>
          <textarea ref={ref} />
          <button>Other control</button>
        </div>
        <input aria-label="Settings" />
      </>
    );
  }
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () => root.render(<Composer active={true} />));
    flush();
    const textarea = node.querySelector("textarea")!,
      button = node.querySelector("button")!,
      settings = node.querySelector("input")!;
    expect(document.activeElement).toBe(textarea);
    button.focus();
    window.dispatchEvent(new Event("focus"));
    flush();
    expect(document.activeElement).toBe(button);
    button.blur();
    window.dispatchEvent(new Event("focus"));
    flush();
    expect(document.activeElement).toBe(textarea);
    await act(async () => root.render(<Composer active={false} />));
    settings.focus();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    flush();
    expect(document.activeElement).toBe(settings);
    await act(async () => root.render(<Composer active={true} />));
    await act(async () => root.render(<Composer active={false} />));
    flush();
    expect(document.activeElement).toBe(settings);
    await act(async () => root.render(<Composer active={true} />));
    flush();
    expect(document.activeElement).toBe(textarea);
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});
