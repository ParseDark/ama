import type { AnnotationOperation, AnnotationShape } from "./annotation-schema";

type Layer = {
  host: HTMLElement;
  svg: SVGSVGElement;
  marks: Map<string, SVGElement>;
  clear: () => void;
};
export type AnnotationResult =
  { ok: true; ids: string[]; count: number } | { ok: false; error: string };

// Serialized by chrome.scripting: keep runtime dependencies inside this function.
export function applyAnnotations(
  op: AnnotationOperation,
  expectedUrl: string,
  limit: number,
): AnnotationResult {
  if (document.visibilityState === "hidden" || location.href !== expectedUrl)
    return { ok: false, error: "The starting webpage is no longer visible." };
  const w = window as Window & { __amaAnnotationLayer?: Layer };
  let layer = w.__amaAnnotationLayer;
  if (layer && !layer.host.isConnected) {
    layer.clear();
    layer = undefined;
  }
  const success = (ids: string[] = []): AnnotationResult => ({
    ok: true,
    ids,
    count: layer?.marks.size ?? 0,
  });
  if (op.action === "clear") {
    layer?.clear();
    return success();
  }
  const existing = op.action !== "add" ? layer?.marks.get(op.id) : undefined;
  if (op.action !== "add" && !existing)
    return { ok: false, error: "Unknown annotation ID on this page." };
  if (op.action === "remove") {
    existing!.remove();
    layer!.marks.delete(op.id);
    if (!layer!.marks.size) layer!.clear();
    return success();
  }
  if (
    op.action === "add" &&
    (layer?.marks.size ?? 0) + op.shapes.length > limit
  )
    return {
      ok: false,
      error: `A layer holds at most ${limit} marks. Remove or clear some first.`,
    };

  const svgNode = <K extends keyof SVGElementTagNameMap>(tag: K) =>
    document.createElementNS("http://www.w3.org/2000/svg", tag);
  const render = (shape: AnnotationShape): SVGElement => {
    const color = {
      red: "#ef4444",
      orange: "#f97316",
      blue: "#2563eb",
      green: "#16a34a",
      purple: "#9333ea",
      white: "#fff",
    }[shape.color ?? "orange"];
    const x = (n: number) => n * window.innerWidth,
      y = (n: number) => n * window.innerHeight;
    const xy = (p: { x: number; y: number }) => `${x(p.x)},${y(p.y)}`;
    if (shape.kind === "label") {
      const text = svgNode("text");
      text.setAttribute("x", String(x(shape.at.x)));
      text.setAttribute("y", String(y(shape.at.y)));
      text.setAttribute("fill", color);
      text.style.cssText =
        "font:600 16px system-ui,sans-serif;paint-order:stroke;stroke:#171717;stroke-width:2px;dominant-baseline:hanging";
      text.textContent = shape.text;
      return text;
    }
    let node: SVGElement;
    if (shape.kind === "ellipse") {
      const ellipse = svgNode("ellipse");
      ellipse.setAttribute("cx", String(x((shape.from.x + shape.to.x) / 2)));
      ellipse.setAttribute("cy", String(y((shape.from.y + shape.to.y) / 2)));
      ellipse.setAttribute(
        "rx",
        String(x(Math.abs(shape.to.x - shape.from.x) / 2)),
      );
      ellipse.setAttribute(
        "ry",
        String(y(Math.abs(shape.to.y - shape.from.y) / 2)),
      );
      node = ellipse;
    } else {
      const path = svgNode("path");
      let d: string;
      if (shape.kind === "polyline") d = "M" + shape.points.map(xy).join(" L");
      else {
        d = `M${xy(shape.from)} L${xy(shape.to)}`;
        if (shape.kind === "arrow") {
          const dx = x(shape.to.x - shape.from.x),
            dy = y(shape.to.y - shape.from.y),
            angle = Math.atan2(dy, dx),
            head = Math.min(12, Math.hypot(dx, dy) / 2);
          const wing = (a: number) =>
            `${x(shape.to.x) - head * Math.cos(a)},${y(shape.to.y) - head * Math.sin(a)}`;
          d += ` M${wing(angle - 0.5)} L${xy(shape.to)} L${wing(angle + 0.5)}`;
        }
      }
      path.setAttribute("d", d);
      node = path;
    }
    node.setAttribute("fill", "none");
    node.setAttribute("stroke", color);
    node.setAttribute("stroke-width", "3");
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("stroke-linejoin", "round");
    return node;
  };
  if (op.action === "replace") {
    const node = render(op.shape);
    existing!.replaceWith(node);
    layer!.marks.set(op.id, node);
    return success([op.id]);
  }
  const nodes = op.shapes.map((shape) => ({
    node: render(shape),
    id: Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
      n.toString(16).padStart(8, "0"),
    ).join(""),
  }));
  if (!layer) {
    const host = document.createElement("div");
    host.style.cssText =
      "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important";
    const shadow = host.attachShadow({ mode: "open" }),
      svg = svgNode("svg");
    svg.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    svg.setAttribute("aria-hidden", "true");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "清除批注";
    button.style.cssText =
      "position:absolute;top:12px;right:12px;pointer-events:auto;background:#222;color:white;border:1px solid #aaa;border-radius:6px;padding:6px 10px;font:14px/1.4 system-ui;cursor:pointer";
    const marks = new Map<string, SVGElement>();
    const clear = () => {
      host.remove();
      marks.clear();
      if (w.__amaAnnotationLayer?.host === host) delete w.__amaAnnotationLayer;
    };
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      clear();
    });
    shadow.append(svg, button);
    document.documentElement.append(host);
    layer = w.__amaAnnotationLayer = { host, svg, marks, clear };
  }
  for (const { id, node } of nodes) {
    layer.svg.append(node);
    layer.marks.set(id, node);
  }
  return success(nodes.map((n) => n.id));
}
