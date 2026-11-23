import { afterEach, beforeEach, expect, it } from "vitest";
import { applyAnnotations } from "@/lib/annotation-layer";
import {
  ANNOTATION_LIMITS,
  type AnnotationOperation,
  type AnnotationShape,
} from "@/lib/annotation-schema";
// happy-dom has neither viewport hit testing nor SVG text layout.
beforeEach(() => {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => document.body,
  });
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 55, height: 16 }),
  });
});
const run = (op: AnnotationOperation) =>
  applyAnnotations(op, location.href, ANNOTATION_LIMITS.marks);
const from = { x: 0, y: 0 },
  to = { x: 0.5, y: 0.5 };
const shapes: AnnotationShape[] = [
  { kind: "line", from, to },
  { kind: "ellipse", from, to },
  { kind: "label", at: to, text: "<b>peak</b>" },
  { kind: "arrow", from, to },
  { kind: "polyline", points: [to, from] },
];
const add = (s = shapes) => {
  const r = run({ action: "add", shapes: s });
  if (!r.ok) throw Error(r.error);
  return r.ids;
};
const root = () => document.documentElement.lastElementChild?.shadowRoot;
afterEach(() => {
  run({ action: "clear" });
  document.body.replaceChildren();
  document.body.style.backgroundColor = "";
  Reflect.deleteProperty(document, "elementFromPoint");
  Reflect.deleteProperty(SVGElement.prototype, "getBBox");
});
it("renders viewport geometry in CSS pixels, literal text and stable replace/remove handles", () => {
  const ids = add();
  expect(new Set(ids).size).toBe(5);
  const svg = root()!.querySelector("svg")!;
  expect(svg.children.length).toBe(5);
  const path = svg.querySelector("path")!;
  expect(path.getAttribute("d")).toContain("C");
  expect(path.getAttribute("stroke-width")).toBe("1.8");
  const oldEllipse = svg.children[1];
  expect(oldEllipse.querySelector("path")).not.toBeNull();
  expect(svg.children[3].querySelectorAll("path")).toHaveLength(2);
  expect(svg.querySelector("text")!.style.font).toContain("15px");
  expect(svg.querySelector("text")!.textContent).toBe("<b>peak</b>");
  expect(svg.querySelector("b")).toBeNull();
  expect(
    run({ action: "replace", id: ids[1], shape: shapes[0] }),
  ).toMatchObject({ ok: true, ids: [ids[1]], count: 5 });
  expect(oldEllipse.isConnected).toBe(false);
  expect(run({ action: "remove", id: ids[2] })).toMatchObject({
    ok: true,
    count: 4,
  });
  expect(run({ action: "remove", id: ids[2] }).ok).toBe(false);
});
it("uses different inks for light and dark CSS surfaces and preserves the explicit accent", () => {
  document.body.style.backgroundColor = "rgb(255, 255, 255)";
  add([shapes[0]]);
  document.body.style.backgroundColor = "rgb(28, 34, 48)";
  add([shapes[0], { ...shapes[0], color: "orange" }]);
  expect(
    Array.from(root()!.querySelectorAll("path"), (p) =>
      p.getAttribute("stroke"),
    ),
  ).toEqual(["#4658a6", "#adbfff", "#f2c879"]);
});
it("rejects exceeding the layer cap without drawing any part of the batch", () => {
  for (let i = 0; i < 4; i++) add(Array(32).fill(shapes[0]));
  expect(run({ action: "add", shapes }).ok).toBe(false);
  expect(root()!.querySelector("svg")!.children.length).toBe(128);
});
it("clears only owned marks and control, including after last remove or loss of host", () => {
  const highlight = document.createElement("div");
  highlight.id = "ama-highlight";
  document.body.append(highlight);
  const ids = add();
  root()!.querySelector("button")!.click();
  expect(root()).toBeFalsy();
  expect(highlight.isConnected).toBe(true);
  expect(run({ action: "clear" })).toMatchObject({ ok: true, count: 0 });
  const [fresh] = add([shapes[0]]);
  expect(fresh).not.toBe(ids[0]);
  expect(run({ action: "remove", id: ids[0] }).ok).toBe(false);
  expect(run({ action: "remove", id: fresh })).toMatchObject({
    ok: true,
    count: 0,
  });
  expect(root()).toBeFalsy();
  add();
  document.documentElement.lastElementChild!.remove();
  add();
  expect(run({ action: "clear" })).toMatchObject({ ok: true, count: 0 });
  expect(highlight.isConnected).toBe(true);
});
