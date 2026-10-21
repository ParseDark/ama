import { expect, it } from "vitest";
import { applyFontScale, FONT_SCALE_VAR } from "@/lib/font-scale";

it("writes the text scale to the document root for CSS px sizes", () => {
  applyFontScale(1.15);
  expect(document.documentElement.style.getPropertyValue(FONT_SCALE_VAR)).toBe(
    "1.15",
  );
  applyFontScale(1);
  expect(document.documentElement.style.getPropertyValue(FONT_SCALE_VAR)).toBe(
    "1",
  );
});
