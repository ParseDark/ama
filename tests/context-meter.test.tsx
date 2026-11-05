import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ContextMeter,
  compactMeter,
  Ring,
  currentModelInfo,
  lastUsage,
} from "@/components/context-meter";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { ReplyUsage } from "@/lib/local-chat-transport";

const usage: ReplyUsage = {
  model: "openai-compatible/claude-haiku-5-5",
  contextTokens: 1250,
  inputTokens: 1200,
  outputTokens: 50,
  cachedInputTokens: 1000,
  total: {
    inputTokens: 2200,
    outputTokens: 70,
    cachedInputTokens: 1000,
    cacheWriteTokens: 0,
  },
  breakdown: {
    system: 100,
    tools: 500,
    page: 300,
    memory: 50,
    conversation: 100,
    run: 200,
    output: 50,
  },
};

it("renders one arc per non-zero source and the window label", () => {
  const html = renderToStaticMarkup(
    <ContextMeter
      usage={usage}
      info={{
        maxInputTokens: 100000,
        pricing: { input: 0.1, output: 0.5, cacheRead: 0.01 },
      }}
    />,
  );
  expect(html).toContain('aria-label="Context window: 1.3k / 100k"');
  expect(html).toContain('data-segments="7"');
  expect(html).toContain("1.3k / 100k");
});

it("places the compact tick at the actual safe-input trigger, not 72% of the window", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers[settings.provider].modelInfo = {
    [settings.providers[settings.provider].model]: {
      contextWindowTokens: 100000,
      maxInputTokens: 100000,
      maxOutputTokens: 8192,
    },
  };
  const marker = compactMeter(settings);
  expect(marker.threshold).toBe(Math.floor((100000 - 8192) * 0.85) * 0.72);
  expect(marker.threshold / marker.whole).toBeCloseTo(0.56186, 4);
  const html = renderToStaticMarkup(
    <ContextMeter
      usage={usage}
      settings={settings}
      info={currentModelInfo(settings)}
    />,
  );
  expect(html).toContain(`data-compact-threshold="${marker.threshold}"`);
  expect(html).toContain('data-compact-enabled="true"');
  expect(html).toContain("Solid ring tick");
  expect(html).not.toContain('stroke-dasharray="0.7 0.8"');
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tick = doc.querySelector("[data-compact-threshold] line")!;
  const angle = (marker.threshold / marker.whole) * 2 * Math.PI;
  expect(Number(tick.getAttribute("x1"))).toBeCloseTo(
    8 + 4.2 * Math.cos(angle),
  );
  expect(Number(tick.getAttribute("y1"))).toBeCloseTo(
    8 + 4.2 * Math.sin(angle),
  );
});

it("renders a disabled dashed threshold and follows overrides, input-only caps and fallback scales", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers[settings.provider].model = "unknown-context-test";
  const fallback = compactMeter(settings);
  expect(fallback).toMatchObject({ fallback: true, whole: 32768 });
  settings.compaction = { enabled: false, contextTokens: 64000 };
  const marker = compactMeter(settings);
  expect(marker).toMatchObject({
    whole: 64000,
    fallback: false,
    enabled: false,
  });
  const html = renderToStaticMarkup(
    <ContextMeter
      usage={usage}
      settings={settings}
      info={currentModelInfo(settings)}
    />,
  );
  expect(html).toContain('data-compact-enabled="false"');
  expect(html).toContain('stroke-dasharray="0.7 0.8"');
  expect(html).toContain("Auto compact off");
  expect(html).toContain("Dashed ring tick");
  settings.compaction = undefined;
  settings.providers[settings.provider].modelInfo = {
    "unknown-context-test": {
      contextWindowTokens: 100000,
      maxInputTokens: 40000,
    },
  };
  expect(compactMeter(settings).threshold).toBe(40000 * 0.85 * 0.72);
});

it("renders tokens without a limit and hides when there is no usage", () => {
  const html = renderToStaticMarkup(<ContextMeter usage={usage} />);
  expect(html).toContain('aria-label="Context window: 1.3k tokens"');
  expect(renderToStaticMarkup(<ContextMeter />)).toBe("");
});

it("rings a fallback single arc without a breakdown", () => {
  const html = renderToStaticMarkup(
    <Ring
      segments={[{ part: "output", tokens: 500, color: "text-current" }]}
      whole={500}
    />,
  );
  expect(html).toContain('data-segments="1"');
  expect(html).toContain("stroke-dasharray");
});

it("finds the latest usage and the current model info", () => {
  const messages = [
    { id: "a", role: "assistant", parts: [], metadata: { usage } },
    { id: "b", role: "user", parts: [] },
  ] as any;
  expect(lastUsage(messages)).toBe(usage);
  expect(lastUsage([])).toBeUndefined();
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers["openai-compatible"].modelInfo = {
    "claude-haiku-5-5": { maxInputTokens: 100000 },
  };
  expect(currentModelInfo(settings)).toEqual({ maxInputTokens: 100000 });
  settings.providers["openai-compatible"].model = "other";
  expect(currentModelInfo(settings)).toBeUndefined();
});

it("falls back to the models.dev catalog when the gateway has no info", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers["openai-compatible"].model = "claude-haiku-5-5";
  settings.providers["openai-compatible"].modelInfo = undefined;
  expect(currentModelInfo(settings)).toMatchObject({
    maxInputTokens: 1000000,
    source: "models.dev",
  });
});
