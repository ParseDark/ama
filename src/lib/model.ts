import type { Settings } from "./settings";
import { mergeSplitUsage } from "./usage-fetch";
export async function createModel(s: Settings) {
  const c = s.providers[s.provider],
    config = { apiKey: c.apiKey, baseURL: c.baseURL || undefined };
  switch (s.provider) {
    case "anthropic":
      return (await import("@ai-sdk/anthropic")).createAnthropic({
        ...config,
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      })(c.model);
    case "google":
      return (await import("@ai-sdk/google")).createGoogleGenerativeAI(config)(
        c.model,
      );
    case "openai":
      return (await import("@ai-sdk/openai")).createOpenAI(config)(c.model);
    default:
      return (await import("@ai-sdk/openai-compatible")).createOpenAICompatible(
        {
          name: "openai-compatible",
          // Ask compatible providers for the optional final streaming usage chunk.
          // Providers that omit it still render unavailable counts, never estimates.
          includeUsage: true,
          // Gateways may split usage across two chunks; keep the running total
          // so the SDK's "last chunk wins" still reports the prompt tokens.
          fetch: mergeSplitUsage((i, n) => globalThis.fetch(i, n)),
          baseURL: c.baseURL,
          apiKey: c.apiKey || undefined,
        },
      )(c.model);
  }
}
