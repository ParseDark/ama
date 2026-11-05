// These functions are serialized by scripting.executeScript. Keep every helper
// inside its exported function: injected code cannot close over module imports.
export async function scrollPage(
  id: string | null | undefined,
  deltaX: number,
  deltaY: number,
) {
  if (
    !Number.isFinite(deltaX) ||
    !Number.isFinite(deltaY) ||
    Math.abs(deltaX) > 10000 ||
    Math.abs(deltaY) > 10000 ||
    (!deltaX && !deltaY)
  )
    return {
      ok: false,
      error: "Use a non-zero scroll of at most 10000 CSS pixels per axis.",
    };
  const root = document.scrollingElement as HTMLElement | null;
  let el = id
    ? document.querySelector<HTMLElement>(`[data-ama-id="${CSS.escape(id)}"]`)
    : root;
  if (!el)
    return {
      ok: false,
      error: id
        ? `Element ${id} is no longer on the page.`
        : "This page has no scrolling element.",
    };
  if (id) {
    while (el) {
      const style = getComputedStyle(el);
      const x =
        deltaX &&
        el.scrollWidth > el.clientWidth &&
        (el === root || /^(auto|scroll|overlay)$/.test(style.overflowX));
      const y =
        deltaY &&
        el.scrollHeight > el.clientHeight &&
        (el === root || /^(auto|scroll|overlay)$/.test(style.overflowY));
      if (x || y) break;
      el = el.parentElement;
    }
    if (!el)
      return {
        ok: false,
        error: "No scrollable ancestor for the requested axes.",
      };
  }
  const before = { x: el.scrollLeft, y: el.scrollTop };
  el.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" });
  // A timer also works in background tabs, where rAF may be suspended.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = { x: el.scrollLeft, y: el.scrollTop };
  const max = {
    x: Math.max(0, el.scrollWidth - el.clientWidth),
    y: Math.max(0, el.scrollHeight - el.clientHeight),
  };
  return {
    ok: true,
    target: el === root ? "page" : (el.dataset.amaId ?? "ancestor"),
    before,
    after,
    max,
    moved: before.x !== after.x || before.y !== after.y,
    atBoundary: {
      x:
        deltaX === 0
          ? null
          : getComputedStyle(el).direction === "rtl"
            ? deltaX > 0
              ? after.x >= 0
              : after.x <= -max.x
            : deltaX > 0
              ? after.x >= max.x
              : after.x <= 0,
      y: deltaY === 0 ? null : deltaY > 0 ? after.y >= max.y : after.y <= 0,
    },
  };
}

export function doubleClickElement(id: string) {
  const el = document.querySelector<HTMLElement>(
    `[data-ama-id="${CSS.escape(id)}"]`,
  );
  if (!el)
    return { ok: false, error: `Element ${id} is no longer on the page.` };
  if (el.closest('[disabled],[aria-disabled="true"],[inert]'))
    return { ok: false, error: "The element is disabled or inert." };
  el.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "instant",
  });
  const rect = el.getBoundingClientRect();
  const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
  const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
  if (
    !rect.width ||
    !rect.height ||
    !el.checkVisibility({ visibilityProperty: true }) ||
    x < 0 ||
    y < 0 ||
    x >= innerWidth ||
    y >= innerHeight
  )
    return { ok: false, error: "The element is not visible in the viewport." };
  const hit = document.elementFromPoint(x, y);
  if (!hit || !el.contains(hit))
    return { ok: false, error: "The element is covered by another element." };
  const send = (type: string, detail: number, buttons = 0) => {
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
      detail,
      view: window,
    };
    return el.dispatchEvent(
      type.startsWith("pointer")
        ? new PointerEvent(type, {
            ...init,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          })
        : new MouseEvent(type, init),
    );
  };
  for (const count of [1, 2]) {
    const currentHit = document.elementFromPoint(x, y);
    if (
      !el.isConnected ||
      !currentHit ||
      !el.contains(currentHit) ||
      el.closest('[disabled],[aria-disabled="true"],[inert]')
    )
      return {
        ok: false,
        error:
          "The target changed after the first click. Read the page before continuing; do not retry blindly.",
        partial: true,
      };
    const pointerAllowed = send("pointerdown", count, 1);
    if (pointerAllowed && send("mousedown", count, 1))
      el.focus({ preventScroll: true });
    send("pointerup", count);
    if (pointerAllowed) send("mouseup", count);
    send("click", count);
  }
  if (!el.isConnected)
    return {
      ok: false,
      partial: true,
      error:
        "The target was removed by a click. Read the page before continuing.",
    };
  send("dblclick", 2);
  return {
    ok: true,
    dispatched: true,
    verified: false,
    note: "Synthetic double-click sent. Check page state; trusted input and native text selection are not supported.",
  };
}

export async function dragElement(
  sourceId: string,
  targetId: string,
  mode: "auto" | "html5" | "pointer" = "auto",
) {
  const find = (id: string) =>
    document.querySelector<HTMLElement>(`[data-ama-id="${CSS.escape(id)}"]`);
  const source = find(sourceId),
    target = find(targetId);
  if (!source || !target)
    return {
      ok: false,
      error: "The source or target is no longer on the page.",
    };
  if (source === target)
    return {
      ok: false,
      error: "Source and target must be different elements.",
    };
  if (
    source.closest('[disabled],[aria-disabled="true"],[inert]') ||
    target.closest('[disabled],[aria-disabled="true"],[inert]')
  )
    return { ok: false, error: "The source or target is disabled or inert." };
  const center = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const x = (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2;
    const y = (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2;
    const hit = document.elementFromPoint(x, y);
    return r.width &&
      r.height &&
      x >= 0 &&
      y >= 0 &&
      x < innerWidth &&
      y < innerHeight &&
      el.checkVisibility({ visibilityProperty: true }) &&
      hit &&
      el.contains(hit)
      ? { x, y }
      : null;
  };
  source.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: "instant",
  });
  target.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: "instant",
  });
  const start = center(source),
    end = center(target);
  if (!start || !end)
    return {
      ok: false,
      error:
        "Both endpoints must be visible and unobscured at the same time. Scroll first; cross-viewport drags are not supported.",
    };
  const selectedMode =
    mode === "auto" ? (source.draggable ? "html5" : "pointer") : mode;
  let started = false,
    dropped = false,
    pointerAllowed = true;
  let lastX = start.x,
    lastY = start.y;
  const transfer = selectedMode === "html5" ? new DataTransfer() : undefined;
  const mouse = (
    el: Element,
    type: string,
    x: number,
    y: number,
    buttons: number,
  ) => {
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: type.endsWith("move") ? -1 : 0,
      buttons,
      view: window,
    };
    return el.dispatchEvent(
      type.startsWith("pointer")
        ? new PointerEvent(type, {
            ...init,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          })
        : new MouseEvent(type, { ...init, button: 0 }),
    );
  };
  const drag = (el: Element, type: string, x: number, y: number) =>
    el.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        dataTransfer: transfer,
      }),
    );
  try {
    if (selectedMode === "html5") {
      started = true;
      if (!drag(source, "dragstart", start.x, start.y))
        return { ok: false, error: "The page cancelled dragstart." };
    } else {
      started = true;
      pointerAllowed = mouse(source, "pointerdown", start.x, start.y, 1);
      if (pointerAllowed && mouse(source, "mousedown", start.x, start.y, 1))
        source.focus({ preventScroll: true });
    }
    let previous: Element | null = null;
    for (let step = 1; step <= 12; step++) {
      if (!source.isConnected || !target.isConnected)
        return {
          ok: false,
          partial: true,
          error:
            "A drag endpoint changed during the gesture. Read the page before continuing.",
        };
      const x = start.x + ((end.x - start.x) * step) / 12;
      const y = start.y + ((end.y - start.y) * step) / 12;
      lastX = x;
      lastY = y;
      const hit = document.elementFromPoint(x, y);
      if (!hit)
        return {
          ok: false,
          partial: true,
          error: "The drag path left the document.",
        };
      if (step === 12 && !target.contains(hit))
        return {
          ok: false,
          partial: true,
          error: "The drop target moved or became covered during the drag.",
        };
      if (selectedMode === "html5") {
        drag(source, "drag", x, y);
        if (hit !== previous) {
          if (previous) drag(previous, "dragleave", x, y);
          drag(hit, "dragenter", x, y);
        }
        const accepted = !drag(hit, "dragover", x, y);
        if (step === 12 && target.contains(hit) && accepted) {
          drag(hit, "drop", x, y);
          dropped = true;
        }
      } else {
        mouse(hit, "pointermove", x, y, 1);
        if (pointerAllowed) mouse(hit, "mousemove", x, y, 1);
      }
      previous = hit;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    if (selectedMode === "html5" && !dropped)
      return {
        ok: false,
        mode: selectedMode,
        error: "The target did not accept dragover; no drop was sent.",
      };
    return {
      ok: true,
      mode: selectedMode,
      dispatched: true,
      verified: false,
      note: "Synthetic drag events sent, not proof of a successful move. Verify the returned page. Native file drags, pointer capture, canvas and trusted-input-only widgets are not supported.",
    };
  } finally {
    if (started) {
      if (selectedMode === "html5") drag(source, "dragend", lastX, lastY);
      else {
        const release = document.elementFromPoint(lastX, lastY) ?? source;
        mouse(release, "pointerup", lastX, lastY, 0);
        if (pointerAllowed) mouse(release, "mouseup", lastX, lastY, 0);
      }
    }
  }
}
