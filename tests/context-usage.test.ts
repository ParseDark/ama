import { it, expect } from "vitest";
import {
  formatCost,
  formatTokens,
  meterLevel,
  replyCost,
} from "@/lib/context-usage";

it("formats token counts with the compact k/M units", () => {
  expect(formatTokens(950)).toBe("950");
  expect(formatTokens(1000)).toBe("1k");
  expect(formatTokens(1250)).toBe("1.3k");
  expect(formatTokens(12345)).toBe("12.3k");
  expect(formatTokens(97050)).toBe("97k");
  expect(formatTokens(100000)).toBe("100k");
  expect(formatTokens(1048576)).toBe("1M");
});

it("classifies the window usage", () => {
  expect(meterLevel()).toBe("ok");
  expect(meterLevel(0.8)).toBe("ok");
  expect(meterLevel(0.81)).toBe("warn");
  expect(meterLevel(0.95)).toBe("warn");
  expect(meterLevel(0.96)).toBe("full");
});

it("prices cached, uncached and output tokens", () => {
  const pricing = {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
  };
  expect(
    replyCost(
      {
        inputTokens: 2200,
        outputTokens: 70,
        cachedInputTokens: 1000,
        cacheWriteTokens: 0,
      },
      1200,
      pricing,
    ),
  ).toBeCloseTo((1200 * 0.1 + 1000 * 0.01 + 70 * 0.5) / 1e6);
});

it("uses the long-context prices above the threshold", () => {
  const pricing = {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    threshold: 100000,
    long: {
      input: 0.5,
      output: 2.5,
      cacheRead: 0.05,
      cacheWrite: 0.625,
    },
  };
  const total = {
    inputTokens: 150000,
    outputTokens: 1000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
  };
  expect(replyCost(total, 150000, pricing)).toBeCloseTo(
    (150000 * 0.5 + 1000 * 2.5) / 1e6,
  );
  expect(replyCost(total, 90000, pricing)).toBeCloseTo(
    (150000 * 0.1 + 1000 * 0.5) / 1e6,
  );
});

it("formats costs with four decimals below a cent", () => {
  expect(formatCost(0.00175)).toBe("$0.0018");
  expect(formatCost(0.0123)).toBe("$0.01");
});
