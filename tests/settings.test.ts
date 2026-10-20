import { it, expect } from "vitest";
import {
  DEFAULT_SETTINGS as D,
  getEmbeddingConfig,
  getMcpServers,
  getConfigProblem,
  getModelGroups,
  selectModel,
} from "@/lib/settings";
it("defaults to the local shell's compatible endpoint, with no bundled credentials", () => {
  expect(D.provider).toBe("openai-compatible");
  expect(D.dangerMode).toBe(false);
  expect(D.providers[D.provider].model).toBe("claude-haiku-5-5");
  expect(D.providers[D.provider].baseURL).toBe("https://api.qnaigc.com/v1");
  for (const provider of Object.values(D.providers))
    expect(provider.apiKey).toBe("");
  expect(getMcpServers(D)[0]).toMatchObject({ name: "Logseq", enabled: false });
  expect(getEmbeddingConfig(D).enabled).toBe(false);
  expect(
    getEmbeddingConfig({
      ...D,
      embedding: { ...getEmbeddingConfig(D), enabled: true },
    }).enabled,
  ).toBe(true);
});
it("groups configured providers current first, dedupes and switches both fields", () => {
  const s = structuredClone(D);
  s.providers.openai.apiKey = "test";
  s.providers.openai.models = ["gpt-5", "other", "other"];
  expect(
    getModelGroups(s).find((g) => g.provider === "openai")?.models,
  ).toEqual(["gpt-5", "other"]);
  expect(getModelGroups(s).some((g) => g.provider === "anthropic")).toBe(false);
  const selected = selectModel(s, "openai", "other");
  expect(selected.provider).toBe("openai");
  expect(selected.providers.openai.model).toBe("other");
  expect(s.provider).toBe(D.provider);
});
it("reports missing fields in priority order", () => {
  const s = structuredClone(D);
  s.providers[D.provider].baseURL = "";
  expect(getConfigProblem(s)).toBe("Base URL is required.");
  s.provider = "openai";
  expect(getConfigProblem(s)).toBe("API key is required.");
  s.providers.openai.apiKey = "x";
  s.providers.openai.model = "";
  expect(getConfigProblem(s)).toBe("Model is required.");
});
