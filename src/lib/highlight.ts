export function highlightElement(id: string, note: string) {
  const w = window as typeof window & { __amaHighlightCleanup?: () => void };
  w.__amaHighlightCleanup?.();
  const el = document.querySelector<HTMLElement>(
    `[data-ama-id="${CSS.escape(id)}"]`,
  );
  if (!el) return { found: false };
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  if (el.matches("input,textarea,select,[contenteditable]"))
    el.focus({ preventScroll: true });
  const box = document.createElement("div");
  box.id = "ama-highlight";
  box.style.cssText =
    "all:initial;position:fixed;z-index:2147483647;border:2px solid #f97316;box-shadow:0 0 0 4px #f9731633,0 0 24px #f9731655;border-radius:6px;pointer-events:none;box-sizing:border-box;";
  const label = document.createElement("div");
  label.textContent = note;
  label.style.cssText =
    "all:initial;position:absolute;left:-2px;max-width:320px;padding:5px 9px;border-radius:4px;background:#f97316;color:white;font:12px/1.4 system-ui;white-space:normal;box-shadow:0 2px 8px #0002;";
  box.append(label);
  document.documentElement.append(box);
  let frame = 0;
  const position = () => {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      left: `${r.left - 3}px`,
      top: `${r.top - 3}px`,
      width: `${r.width + 6}px`,
      height: `${r.height + 6}px`,
    });
    label.style.top = r.top < 32 ? `${r.height + 8}px` : "auto";
    label.style.bottom = r.top < 32 ? "auto" : "calc(100% + 5px)";
    frame = requestAnimationFrame(position);
  };
  position();
  const cleanup = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    box.remove();
    document.removeEventListener("pointerdown", cleanup, true);
    if (w.__amaHighlightCleanup === cleanup) delete w.__amaHighlightCleanup;
  };
  const timer = setTimeout(cleanup, 6000);
  document.addEventListener("pointerdown", cleanup, true);
  w.__amaHighlightCleanup = cleanup;
  return { found: true };
}
