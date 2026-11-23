import type { AnnotationOperation } from "./annotation-schema";
import { annotationPen, fitLabel } from "./annotation-ink";

type Layer = ReturnType<typeof createLayer>;
declare global {
  interface Window {
    __amaAnnotationLayer?: Layer;
    __amaApplyAnnotations?: typeof applyAnnotations;
  }
}
export type AnnotationResult =
  { ok: true; ids: string[]; count: number } | { ok: false; error: string };
function createLayer() {
  const host = document.createElement("div");
  host.style.cssText =
    "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important";
  const shadow = host.attachShadow({ mode: "open" }),
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;stroke-linecap:round;stroke-linejoin:round";
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
    if (window.__amaAnnotationLayer?.host === host)
      delete window.__amaAnnotationLayer;
  };
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    clear();
  });
  shadow.append(svg, button);
  return { host, svg, marks, clear, render: annotationPen(svg) };
}
export function applyAnnotations(
  op: AnnotationOperation,
  expectedUrl: string,
  limit: number,
): AnnotationResult {
  if (document.visibilityState === "hidden" || location.href !== expectedUrl)
    return { ok: false, error: "The starting webpage is no longer visible." };
  let layer = window.__amaAnnotationLayer;
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
  if (op.action !== "add") {
    const existing = layer?.marks.get(op.id);
    if (!layer || !existing)
      return { ok: false, error: "Unknown annotation ID on this page." };
    if (op.action === "remove") {
      existing.remove();
      layer.marks.delete(op.id);
      if (!layer.marks.size) layer.clear();
      return success();
    }
    const node = layer.render(op.shape, op.id);
    existing.replaceWith(node);
    layer.marks.set(op.id, node);
    fitLabel(node);
    return success([op.id]);
  }
  if ((layer?.marks.size ?? 0) + op.shapes.length > limit)
    return {
      ok: false,
      error: `A layer holds at most ${limit} marks. Remove or clear some first.`,
    };
  layer ??= createLayer();
  const nodes = op.shapes.map((shape) => {
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
      n.toString(16).padStart(8, "0"),
    ).join("");
    return { id, node: layer.render(shape, id) };
  });
  if (!layer.host.isConnected) {
    document.documentElement.append(layer.host);
    window.__amaAnnotationLayer = layer;
  }
  for (const { id, node } of nodes) {
    layer.svg.append(node);
    layer.marks.set(id, node);
    fitLabel(node);
  }
  return success(nodes.map((n) => n.id));
}
