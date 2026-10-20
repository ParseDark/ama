import { z } from "zod";
import type { WebSearchConfig } from "../settings";

const API = "https://api.deepseek.com/v1/tools";
export const MAX_CONTENT = 24000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const unicodeLength = (s: string) => [...s].length;
export const querySchema = z
  .string()
  .trim()
  .refine(
    (s) => unicodeLength(s) >= 1 && unicodeLength(s) <= 128,
    "Search query must contain 1–128 Unicode characters.",
  );
export const searchInputSchema = z.object({
  query: querySchema,
  count: z.number().int().min(1).max(10).default(5),
});

// Public web only. No DNS lookup is performed here; DeepSeek also enforces its
// own fetch security policy. Reject IP literals conservatively, including IPv6.
export function publicWebUrl(value: string): string {
  if (value.length > 8192) throw new Error("URL exceeds 8192 characters.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("A public HTTP(S) URL is required.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(
      host,
    ) ||
    /(?:^|\.)(?:localdomain|nip\.io|sslip\.io|lvh\.me)$/.test(host) ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("Only public web URLs without credentials are allowed.");
  for (const [key, val] of url.searchParams) {
    if (
      /(?:token|secret|password|passwd|credential|signature|authorization|api[-_]?key|session|^code$|^key$|^sig$|^auth$)/i.test(
        key,
      ) ||
      /\bsk-[a-z0-9]{16,}/i.test(val)
    )
      throw new Error(
        "URLs with sensitive query parameters cannot be sent to web search.",
      );
  }
  url.hash = "";
  return url.href;
}
export const fetchInputSchema = z.object({
  url: z.string().refine((s) => {
    try {
      publicWebUrl(s);
      return true;
    } catch {
      return false;
    }
  }, "Use a public HTTP(S) URL without credentials or sensitive parameters."),
});
const resultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  summary: z.string(),
  date: z.string().nullable().optional(),
  site_name: z.string().nullable().optional(),
  rerank_score: z.number().optional(),
  authority: z.number().optional(),
});
const responseSchema = z.object({ results: z.array(resultSchema).max(50) });
export interface WebSource {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  date: string | null;
  siteName: string | null;
}
export interface SearchOutput {
  results: WebSource[];
  omitted: number;
  truncated: boolean;
}
export interface FetchOutput {
  url: string;
  title: string;
  content: string;
  truncated: boolean;
}
const nextRequest = { search: 0, fetch: 0 };
async function wait(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Web search returned an empty response.");
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Web search response exceeded the 2 MiB limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
function httpError(status: number) {
  const messages: Record<number, string> = {
    401: "Invalid DeepSeek API key. Update Settings → Tools → Web search.",
    402: "DeepSeek balance is insufficient. Top up before retrying.",
    403: "DeepSeek rejected this URL under its security policy.",
    404: "DeepSeek could not extract this page. It may require login or block remote fetching; use browser tools if appropriate.",
    429: "DeepSeek rate limit reached. Wait before retrying.",
  };
  return new Error(
    messages[status] ?? `DeepSeek web request failed (HTTP ${status}).`,
  );
}
export class DeepSeekWebClient {
  constructor(
    private config: WebSearchConfig,
    private fetchFn: typeof fetch = fetch,
  ) {}
  private async request(
    kind: "search" | "fetch",
    body: unknown,
    signal?: AbortSignal,
  ) {
    const timeout = AbortSignal.timeout(25000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const key = this.config.apiKey.trim();
    if (!key)
      throw new Error(
        "Configure a DeepSeek API key in Settings → Tools → Web search.",
      );
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        combined.throwIfAborted();
        const slot = Math.max(Date.now(), nextRequest[kind]);
        nextRequest[kind] = slot + 250;
        await wait(Math.max(0, slot - Date.now()), combined);
        // Native fetch must not receive the client instance as its receiver.
        const fetchFn = this.fetchFn;
        const response = await fetchFn(`${API}/${kind}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: combined,
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
        });
        if (response.ok) return await boundedJson(response);
        await response.body?.cancel();
        if (
          attempt === 0 &&
          (response.status === 408 ||
            response.status === 429 ||
            response.status >= 500)
        ) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await wait(
            Math.min(
              5000,
              Math.max(
                600,
                Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
              ),
            ),
            combined,
          );
          continue;
        }
        throw httpError(response.status);
      }
      throw new Error("DeepSeek web request failed.");
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (timeout.aborted)
        throw new Error("DeepSeek web request timed out after 25 seconds.");
      // Never propagate endpoint response bodies or fetch errors that could echo credentials.
      if (
        error instanceof TypeError ||
        error instanceof SyntaxError ||
        error instanceof z.ZodError
      )
        throw new Error(
          "DeepSeek web request failed or returned an invalid response.",
        );
      throw error;
    }
  }
  async search(
    input: z.input<typeof searchInputSchema>,
    signal?: AbortSignal,
  ): Promise<SearchOutput> {
    const { query, count } = searchInputSchema.parse(input);
    if (
      /\bsk-[a-z0-9]{16,}/i.test(query) ||
      /\b(?:api[-_]?key|access[-_]?token|password|secret|authorization)\s*[:=]\s*\S+/i.test(
        query,
      )
    )
      throw new Error("Do not include credentials in search queries.");
    for (const url of query.match(/https?:\/\/[^\s<>"']+/gi) ?? [])
      publicWebUrl(url);
    const parsed = responseSchema.safeParse(
      await this.request(
        "search",
        { query, count, need_content: false },
        signal,
      ),
    );
    if (!parsed.success)
      throw new Error("DeepSeek returned invalid search results.");
    const results: WebSource[] = [];
    let omitted = 0,
      truncated = parsed.data.results.length > count;
    for (const r of parsed.data.results.slice(0, count)) {
      let url: string;
      try {
        url = publicWebUrl(r.url);
      } catch {
        omitted++;
        continue;
      }
      truncated ||=
        r.title.length > 300 ||
        r.snippet.length > 500 ||
        r.summary.length > 1600;
      results.push({
        title: r.title.slice(0, 300),
        url,
        snippet: r.snippet.slice(0, 500),
        summary: r.summary.slice(0, 1600),
        date: r.date?.slice(0, 50) ?? null,
        siteName: r.site_name?.slice(0, 200) ?? null,
      });
    }
    return { results, omitted, truncated };
  }
  async fetchPage(
    input: z.input<typeof fetchInputSchema>,
    signal?: AbortSignal,
  ): Promise<FetchOutput> {
    const url = publicWebUrl(input.url);
    const parsed = z
      .object({ title: z.string(), content: z.string() })
      .safeParse(await this.request("fetch", { url }, signal));
    if (!parsed.success || !parsed.data.content.trim())
      throw new Error("DeepSeek returned no usable page content.");
    return {
      url,
      title: parsed.data.title.slice(0, 300),
      content: parsed.data.content.slice(0, MAX_CONTENT),
      truncated: parsed.data.content.length > MAX_CONTENT,
    };
  }
}
