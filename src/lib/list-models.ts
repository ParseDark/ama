import type {
  ModelInfo,
  ModelPricing,
  ProviderId,
  ProviderConfig,
  TokenPrices,
} from "./settings";
import { catalogModelInfo, mergeModelInfo } from "./model-catalog";

/** Only positive, finite numbers are useful (providers also send 0 / null). */
const positive = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
};
const first = (...values: unknown[]) => {
  for (const value of values) {
    const found = positive(value);
    if (found !== undefined) return found;
  }
  return undefined;
};

function tokenPrices(raw: any): TokenPrices | undefined {
  const input = positive(raw?.input),
    output = positive(raw?.output);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = positive(raw?.cache_read),
    cacheWrite = positive(raw?.cache_write);
  return {
    input,
    output,
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
  };
}

/** Maps a provider /models entry (OpenAI-compatible, Google, Anthropic) to the
 * limits and prices the context meter needs. Unknown shapes yield undefined. */
export function modelInfoOf(raw: any): ModelInfo | undefined {
  const capabilities = raw?.capabilities ?? {},
    limits = raw?.limits ?? {},
    metadata = raw?.metadata ?? {},
    maxInputTokens = first(
      raw?.max_input_tokens,
      raw?.maxInputTokens,
      raw?.context_length,
      raw?.contextLength,
      raw?.context_window,
      raw?.contextWindow,
      raw?.context_size,
      raw?.max_context_length,
      raw?.inputTokenLimit,
      capabilities.max_input_tokens,
      capabilities.maxInputTokens,
      capabilities.context_length,
      capabilities.context_window,
      capabilities.inputTokenLimit,
      limits.max_input_tokens,
      limits.context_length,
      limits.context_window,
      metadata.max_input_tokens,
      metadata.context_length,
      metadata.context_window,
    ),
    maxOutputTokens = first(
      raw?.capabilities?.max_output_tokens,
      capabilities.max_output_tokens,
      capabilities.maxOutputTokens,
      raw?.max_output_tokens,
      raw?.maxOutputTokens,
      raw?.max_tokens,
      raw?.outputTokenLimit,
      capabilities.max_tokens,
      limits.max_output_tokens,
      limits.max_tokens,
      metadata.max_output_tokens,
      metadata.max_tokens,
    );
  let pricing: ModelPricing | undefined;
  const p = raw?.pricing ?? capabilities.pricing;
  if (p?.unit === "usd_per_mtok") {
    const base = tokenPrices(p);
    if (base) {
      const threshold = positive(p.threshold),
        long = tokenPrices(p.long);
      pricing = {
        ...base,
        ...(threshold !== undefined ? { threshold } : {}),
        ...(long ? { long } : {}),
      };
    }
  }
  if (maxInputTokens === undefined && maxOutputTokens === undefined && !pricing)
    return undefined;
  return {
    ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(pricing ? { pricing } : {}),
  };
}

export async function listModelsWithInfo(
  provider: ProviderId,
  c: ProviderConfig,
  fetchFn: typeof fetch = (i, n) => globalThis.fetch(i, n),
): Promise<{ models: string[]; info: Record<string, ModelInfo> }> {
  const base = (
    c.baseURL ||
    {
      openai: "https://api.openai.com/v1",
      anthropic: "https://api.anthropic.com/v1",
      google: "https://generativelanguage.googleapis.com/v1beta",
      "openai-compatible": "",
    }[provider]
  ).replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (provider === "anthropic")
    Object.assign(headers, {
      "x-api-key": c.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
  else if (provider === "google") headers["x-goog-api-key"] = c.apiKey;
  else if (c.apiKey) headers.Authorization = `Bearer ${c.apiKey}`;
  const ids: string[] = [],
    info: Record<string, ModelInfo> = {};
  let cursor = "";
  const seen = new Set<string>();
  do {
    const q =
      provider === "anthropic"
        ? `?limit=1000${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ""}`
        : provider === "google"
          ? `?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ""}`
          : "";
    const r = await fetchFn(`${base}/models${q}`, { headers });
    if (!r.ok)
      throw new Error(
        `Listing models failed with ${r.status}: ${(await r.text()).slice(0, 300)}`,
      );
    const d = await r.json();
    const raw =
      provider === "google"
        ? (d.models ?? []).filter((m: any) =>
            m.supportedGenerationMethods?.includes("generateContent"),
          )
        : Array.isArray(d)
          ? d
          : (d.data ?? d.models ?? []);
    for (const m of raw) {
      // Google's id is `name` without the `models/` prefix; some compatible
      // gateways only send `name` for non-Google providers too.
      const id =
        provider === "google" || !m.id
          ? String(m.name ?? "").replace(/^models\//, "")
          : m.id;
      if (typeof id !== "string" || !id) continue;
      ids.push(id);
      const details = mergeModelInfo(
        modelInfoOf(m),
        catalogModelInfo(provider, id, c.baseURL),
      );
      if (details) info[id] = details;
    }
    cursor =
      provider === "google"
        ? (d.nextPageToken ?? "")
        : provider === "anthropic" && d.has_more
          ? (d.last_id ?? d.data?.at(-1)?.id ?? "")
          : "";
    if (seen.has(cursor)) break;
    seen.add(cursor);
  } while (cursor);
  return { models: [...new Set(ids)].sort(), info };
}

export async function listModels(
  provider: ProviderId,
  c: ProviderConfig,
  fetchFn?: typeof fetch,
): Promise<string[]> {
  return (await listModelsWithInfo(provider, c, fetchFn)).models;
}
