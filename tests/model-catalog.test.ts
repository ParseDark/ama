import { expect, it } from "vitest";
import { catalogModelInfo, mergeModelInfo } from "@/lib/model-catalog";
import type { ModelInfo } from "@/lib/settings";

it("finds the current models.dev entry by provider or model id", () => {
  expect(catalogModelInfo("anthropic", "claude-haiku-5-5")).toMatchObject({
    maxInputTokens: 1000000,
    maxOutputTokens: 128000,
    source: "models.dev",
    pricing: {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
    },
  });
  expect(
    catalogModelInfo(
      "openai-compatible",
      "claude-haiku-5-5",
      "https://api.qnaigc.com/v1",
    ),
  ).toMatchObject({ maxInputTokens: 1000000, source: "models.dev" });
  expect(catalogModelInfo("openai", "definitely-not-a-model")).toBeUndefined();
});

it("keeps gateway limits over catalog limits", () => {
  const gateway: ModelInfo = {
    maxInputTokens: 100000,
    maxOutputTokens: 128000,
  };
  const catalog = catalogModelInfo("anthropic", "claude-haiku-5-5")!;
  expect(mergeModelInfo(gateway, catalog)).toMatchObject({
    maxInputTokens: 100000,
    maxOutputTokens: 128000,
    pricing: catalog.pricing,
  });
  expect(mergeModelInfo(gateway, catalog)?.source).toBeUndefined();
});

it("marks a limit that only the catalog supplied", () => {
  const catalog = catalogModelInfo("anthropic", "claude-haiku-5-5")!;
  expect(mergeModelInfo({ maxOutputTokens: 9000 }, catalog)).toMatchObject({
    maxInputTokens: 1000000,
    maxOutputTokens: 9000,
    source: "models.dev",
  });
  expect(mergeModelInfo(undefined, catalog)).toMatchObject({
    maxInputTokens: 1000000,
    source: "models.dev",
  });
});
