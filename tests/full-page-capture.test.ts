import { it, expect } from "vitest";
import { planCapture, stitchLayout } from "@/lib/full-page-capture";
it("flushes last frame and caps height", () => {
  expect(planCapture(2500, 1000)).toEqual([0, 1000, 1500]);
  expect(planCapture(400, 1000)).toEqual([0]);
  expect(planCapture(20000, 1000).at(-1)).toBe(11000);
});
it("scales by actual frame ratio within limits", () => {
  const l = stitchLayout(800, 2000, 400, 10000);
  expect(l.ratio).toBe(2);
  expect(l.height).toBe(8000);
  expect(l.width).toBe(320);
});
