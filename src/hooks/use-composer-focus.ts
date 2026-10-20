import { useEffect, type RefObject } from "react";

/** Focus on chat entry, not on every render/token or controls being used. */
export function useComposerFocus(
  ref: RefObject<HTMLTextAreaElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const focus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const input = ref.current;
        if (input?.isConnected && !input.closest("[hidden]"))
          input.focus({ preventScroll: true });
      });
    };
    // A newly mounted chat, or returning from settings/history/memory.
    focus();
    const resume = () => {
      // A retained panel may become visible/focused again without remounting.
      // Keep focus on its current field/button if the user is using one.
      if (
        document.visibilityState !== "hidden" &&
        (!document.activeElement ||
          document.activeElement === document.body ||
          document.activeElement === document.documentElement)
      )
        focus();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [ref, active]);
}
