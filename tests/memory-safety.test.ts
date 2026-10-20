import { it, expect } from "vitest";
import { findSensitiveContent } from "@/lib/memory/safety";
it("refuses credentials and cards even when typed", () => {
  expect(
    findSensitiveContent("password is hello", {
      userTexts: ["password is hello"],
    }),
  ).toBe("credentials");
  expect(findSensitiveContent("4111 1111 1111 1111")).toBe("a card number");
});
it("requires every URL in user text, handles CJK punctuation", () => {
  expect(
    findSensitiveContent("查看 https://example.com/a。", {
      userTexts: ["记住 https://example.com/a。"],
    }),
  ).toBeNull();
  expect(findSensitiveContent("use example.com")).toBe("a URL");
  expect(findSensitiveContent("hello")).toBeNull();
});
