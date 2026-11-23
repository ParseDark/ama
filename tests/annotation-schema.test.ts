import { expect, it } from "vitest";
import { annotationInput } from "@/lib/annotation-schema";
const from = { x: 0, y: 0 },
  to = { x: 1, y: 1 };
const valid = (shapes: unknown[]) =>
  annotationInput.safeParse({ operation: { action: "add", shapes } }).success;
const line = { kind: "line", from, to };
it("accepts all mark types and inclusive viewport edges", () => {
  expect(
    valid([
      line,
      { ...line, kind: "arrow" },
      { ...line, kind: "ellipse" },
      { kind: "polyline", points: [from, to] },
      { kind: "label", at: to, text: "peak", color: "purple" },
    ]),
  ).toBe(true);
});
it("rejects a whole mixed batch, unknown fields, invalid geometry and excessive input", () => {
  for (const invalid of [
    { ...line, from: { x: -1, y: 0 } },
    { ...line, to: { x: 0, y: 1.01 } },
    { ...line, to: { x: NaN, y: 1 } },
    { ...line, color: "url(test)" },
    { ...line, html: "tag" },
    { kind: "polyline", points: Array(129).fill(to) },
    { kind: "label", at: to, text: "a".repeat(161) },
  ])
    expect(valid([line, invalid])).toBe(false);
  expect(valid([])).toBe(false);
  expect(valid(Array(33).fill(line))).toBe(false);
  expect(
    annotationInput.safeParse({ operation: { action: "clear" }, tab: 2 })
      .success,
  ).toBe(false);
});
