import { afterEach, expect, it } from "vitest";
import { applyAnnotations } from "@/lib/annotation-layer";
import {
  ANNOTATION_LIMITS,
  type AnnotationOperation,
  type AnnotationShape,
} from "@/lib/annotation-schema";
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
});
it("renders viewport geometry in CSS pixels, literal text and stable replace/remove handles", () => {
  const ids = add();
  expect(new Set(ids).size).toBe(5);
  const svg = root()!.querySelector("svg")!;
  expect(svg.children.length).toBe(5);
  expect(svg.querySelector("path")!.getAttribute("d")).toBe(
    `M0,0 L${innerWidth / 2},${innerHeight / 2}`,
  );
  expect(svg.querySelector("path")!.getAttribute("stroke-width")).toBe("3");
  expect(svg.querySelector("text")!.style.font).toContain("16px");
  expect(svg.querySelector("text")!.textContent).toBe("<b>peak</b>");
  expect(svg.querySelector("b")).toBeNull();
  expect(
    run({ action: "replace", id: ids[1], shape: shapes[0] }),
  ).toMatchObject({ ok: true, ids: [ids[1]], count: 5 });
  expect(svg.querySelector("ellipse")).toBeNull();
  expect(run({ action: "remove", id: ids[2] })).toMatchObject({
    ok: true,
    count: 4,
  });
  expect(run({ action: "remove", id: ids[2] }).ok).toBe(false);
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
