import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ContextMeter,
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
