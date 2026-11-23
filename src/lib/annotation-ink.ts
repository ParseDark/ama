import rough from "roughjs";
import type { AnnotationShape } from "./annotation-schema";

type Point = [number, number];
const light = {
  blue: "#4658a6",
  orange: "#97651f",
  red: "#a54e5c",
  green: "#39745f",
  purple: "#765796",
  white: "#ffffff",
};
const dark = {
  blue: "#adbfff",
  orange: "#f2c879",
  red: "#efa7ac",
  green: "#8ed2b0",
  purple: "#cdb4ea",
  white: "#ffffff",
};
const ns = "http://www.w3.org/2000/svg";

// Inspect CSS at the mark, not the browser theme: dark charts often live on
// white pages. Canvas pixels/images aren't read; transparent surfaces inherit.
function darkSurface([x, y]: Point) {
  let el: Element | null = document.elementFromPoint(x, y) ?? document.body;
  while (el) {
    const rgba = getComputedStyle(el)
      .backgroundColor.match(/^rgba?\(([^)]+)\)$/)?.[1]
      .split(",")
      .map(Number);
    if (rgba && (rgba[3] ?? 1) >= 0.8)
      return 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2] < 145;
    el = el.parentElement;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function annotationPen(svg: SVGSVGElement) {
  const pen = rough.svg(svg);
  const point = (p: { x: number; y: number }): Point => [
    p.x * innerWidth,
    p.y * innerHeight,
  ];
  return (shape: AnnotationShape, id: string): SVGElement => {
    const anchor =
      shape.kind === "label"
        ? shape.at
        : shape.kind === "polyline"
          ? shape.points[0]
          : {
              x: (shape.from.x + shape.to.x) / 2,
              y: (shape.from.y + shape.to.y) / 2,
            };
    const onDark = darkSurface(point(anchor));
    const stroke = (onDark ? dark : light)[shape.color ?? "blue"];
    if (shape.kind === "label") {
      const [x, y] = point(shape.at);
      const badge = document.createElementNS(ns, "g"),
        bg = document.createElementNS(ns, "rect"),
        text = document.createElementNS(ns, "text");
      badge.setAttribute("transform", `translate(${x} ${y})`);
      bg.setAttribute(
        "fill",
        onDark || shape.color === "white" ? "#212631" : "#fffdf7",
      );
      bg.setAttribute("fill-opacity", ".95");
      bg.setAttribute("rx", "4");
      text.style.cssText =
        "font:600 15px system-ui,sans-serif;dominant-baseline:hanging";
      text.setAttribute("fill", stroke);
      text.textContent = shape.text;
      badge.append(bg, text);
      return badge;
    }
    const options = {
      stroke,
      strokeWidth: 1.8,
      roughness: shape.kind === "ellipse" ? 0.95 : 0.55,
      bowing: 0.65,
      disableMultiStroke: true,
      preserveVertices: true,
      seed: parseInt(id.slice(0, 8), 16) & 0x7fffffff || 1,
    };
    if (shape.kind === "polyline")
      return pen.linearPath(shape.points.map(point), options);
    const [x, y] = point(shape.from),
      [u, v] = point(shape.to);
    if (shape.kind === "ellipse")
      return pen.ellipse(
        (x + u) / 2,
        (y + v) / 2,
        Math.abs(u - x),
        Math.abs(v - y),
        options,
      );
    const shaft = pen.line(x, y, u, v, options);
    if (shape.kind === "arrow") {
      const angle = Math.atan2(v - y, u - x),
        head = Math.min(12, Math.hypot(u - x, v - y) / 2);
      const wing = (a: number): Point => [
        u - head * Math.cos(a),
        v - head * Math.sin(a),
      ];
      shaft.append(
        pen.linearPath([wing(angle - 0.5), [u, v], wing(angle + 0.5)], options),
      );
    }
    return shaft;
  };
}

// Measure only after insertion: use actual glyph metrics (also for CJK).
export function fitLabel(node: SVGElement) {
  const text = node.querySelector("text"),
    bg = node.querySelector("rect");
  if (!text || !bg) return;
  const b = text.getBBox();
  for (const [name, value] of Object.entries({
    x: b.x - 5,
    y: b.y - 2,
    width: b.width + 10,
    height: b.height + 4,
  }))
    bg.setAttribute(name, String(value));
}
