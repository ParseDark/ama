import { storage } from "wxt/utils/storage";
export type ProviderId =
  "openai" | "anthropic" | "google" | "openai-compatible";
export interface TokenPrices {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}
export interface ModelPricing extends TokenPrices {
  threshold?: number;
  long?: TokenPrices;
}
export interface ModelInfo {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  pricing?: ModelPricing;
  /** Set when the limit came from the bundled models.dev snapshot. */
  source?: "models.dev";
}
export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  models?: string[];
  modelInfo?: Record<string, ModelInfo>;
}
export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  token: string;
  headers?: Record<string, string>;
  enabled: boolean;
}
export interface EmbeddingConfig {
  enabled: boolean;
  url: string;
  model: string;
  token: string;
  dimensions: number;
  minScore: number;
}
export interface WebSearchConfig {
  enabled: boolean;
  provider: "deepseek";
  apiKey: string;
}
export const DEFAULT_WEB_SEARCH: WebSearchConfig = {
  enabled: false,
  provider: "deepseek",
  apiKey: "",
};
export interface Settings {
  provider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  mcpServers?: McpServerConfig[];
  embedding?: EmbeddingConfig;
  webSearch?: WebSearchConfig;
  dangerMode?: boolean;
}
export const PROVIDERS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  "openai-compatible": "OpenAI compatible",
};
export const DEFAULT_SETTINGS: Settings = {
  provider: "openai-compatible",
  dangerMode: false,
  providers: {
    openai: { apiKey: "", model: "gpt-5", baseURL: "" },
    anthropic: { apiKey: "", model: "claude-sonnet-5-5", baseURL: "" },
    google: { apiKey: "", model: "gemini-2.5-flash", baseURL: "" },
    "openai-compatible": {
      apiKey: "",
      model: "claude-haiku-5-5",
      baseURL: "https://api.qnaigc.com/v1",
    },
  },
};
export const DEFAULT_EMBEDDING: EmbeddingConfig = {
  enabled: false,
  url: "http://127.0.0.1:8765/v1",
  model: "jina-v5-small",
  token: "",
  dimensions: 1024,
  minScore: 0.28,
};
export const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  {
    id: "logseq",
    name: "Logseq",
    url: "http://127.0.0.1:12315/mcp",
    token: "",
    enabled: false,
  },
];
export const settingsStore = storage.defineItem<Settings>("local:settings", {
  fallback: DEFAULT_SETTINGS,
});
const settingsLock = <T>(f: () => Promise<T>) =>
  navigator.locks ? navigator.locks.request("ama-settings-store", f) : f();
/** Serialized read-modify-write, so parallel tool calls cannot drop a change. */
export const updateSettings = (
  fn: (s: Settings) => Settings | Promise<Settings>,
) =>
  settingsLock(async () => {
    const next = await fn(await settingsStore.getValue());
    await settingsStore.setValue(next);
    return next;
  });
export const getEmbeddingConfig = (s: Settings): EmbeddingConfig => ({
  ...DEFAULT_EMBEDDING,
  ...s.embedding,
});
export const getWebSearchConfig = (s: Settings): WebSearchConfig => ({
  ...DEFAULT_WEB_SEARCH,
  ...s.webSearch,
});
export const getMcpServers = (s: Settings) =>
  s.mcpServers ?? DEFAULT_MCP_SERVERS;
export function getConfigProblem(s: Settings) {
  const c = s.providers[s.provider];
  return s.provider === "openai-compatible" && !c.baseURL.trim()
    ? "Base URL is required."
    : s.provider !== "openai-compatible" && !c.apiKey.trim()
      ? "API key is required."
      : !c.model.trim()
        ? "Model is required."
        : null;
}
export function getModelGroups(s: Settings) {
  return (Object.keys(PROVIDERS) as ProviderId[])
    .filter((p) =>
      p === "openai-compatible"
        ? s.providers[p].baseURL
        : s.providers[p].apiKey,
    )
    .map((provider) => ({
      provider,
      label: PROVIDERS[provider],
      models: [
        ...new Set([
          s.providers[provider].model,
          ...(s.providers[provider].models ?? []),
        ]),
      ].filter(Boolean),
    }));
}
export const selectModel = (
  s: Settings,
  provider: ProviderId,
  model: string,
): Settings => ({
  ...s,
  provider,
  providers: {
    ...s.providers,
    [provider]: { ...s.providers[provider], model },
  },
});
