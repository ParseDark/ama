import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_SETTINGS, getWebSearchConfig } from "@/lib/settings";
import {
  DeepSeekWebClient,
  MAX_CONTENT,
  publicWebUrl,
  searchInputSchema,
} from "@/lib/web-search/client";
import { createWebTools, webUsage } from "@/lib/web-search/tools";
import { buildInstructions } from "@/lib/prompt";
import { ToolPart } from "@/components/tool-parts";
import { WebSearchSettings } from "@/components/web-search-settings";

const config = {
  enabled: true,
  provider: "deepseek" as const,
  apiKey: "test-secret-key",
};
const settings = { ...DEFAULT_SETTINGS, webSearch: config };
const result = {
  title: "Official docs",
  url: "https://api-docs.deepseek.com/guides/search",
  snippet: "Short display summary",
  summary: "Long summary for the model",
  content: "DO_NOT_RETURN_FULL_CONTENT",
  site_name: "DeepSeek",
  site_icon: "https://tracker.example.com/icon",
  date: null,
  authority: 3,
  rerank_score: 2.5,
};
const respond = (body: unknown) =>
  vi.fn<typeof fetch>(async () => Response.json(body));
const opts = { toolCallId: "c", messages: [] };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("is independently configurable, off by default and hidden without a key", () => {
  expect(getWebSearchConfig(DEFAULT_SETTINGS)).toEqual({
    enabled: false,
    provider: "deepseek",
    apiKey: "",
  });
  expect(createWebTools(DEFAULT_SETTINGS, [])).toEqual({});
  expect(
    createWebTools({ ...settings, webSearch: { ...config, apiKey: " " } }, []),
  ).toEqual({});
  expect(Object.keys(createWebTools(settings, []))).toEqual([
    "web_search",
    "web_fetch",
  ]);
  expect(buildInstructions(null)).not.toContain("Public web tools are enabled");
  const prompt = buildInstructions(null, [], undefined, config);
  expect(prompt).toContain("Public web tools are enabled");
  expect(prompt).toContain("untrusted data");
  expect(prompt).not.toContain(config.apiKey);
  const ui = renderToStaticMarkup(
    <WebSearchSettings settings={settings} onChange={() => {}} />,
  );
  expect(ui).toContain("DeepSeek search API key");
  expect(ui).toContain("search queries and fetched URLs are sent to DeepSeek");
});

it("validates Unicode query lengths, count, whitespace and preserves search operators", () => {
  expect(
    searchInputSchema.parse({ query: " 🦄".trim().repeat(128) }).count,
  ).toBe(5);
  for (const input of [
    { query: " " },
    { query: "a".repeat(129) },
    { query: "x", count: 11 },
    { query: "x", count: 0 },
  ])
    expect(searchInputSchema.safeParse(input).success).toBe(false);
  expect(
    searchInputSchema.parse({
      query: 'DeepSeek site:github.com after:2025 "search"',
    }).query,
  ).toContain("site:github.com");
});

it("blocks credential-bearing, private, non-web and suspicious URLs without network calls", async () => {
  const fetchFn = respond({});
  const client = new DeepSeekWebClient(config, fetchFn);
  for (const url of [
    "http://localhost/a",
    "http://127.1/a",
    "http://0x7f000001/a",
    "http://10.0.0.1/a",
    "http://169.254.169.254/a",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://intranet/",
    "https://host.local/",
    "https://foo.internal/",
    "https://127.0.0.1.nip.io/",
    "https://foo.com:8080/",
    "https://user:pass@github.com/",
    "file:///tmp/x",
    "javascript:alert(1)",
    "https://github.com/?access_token=secret",
    "https://github.com/?X-Amz-Signature=secret",
    "https://github.com/?code=secret",
  ])
    await expect(client.fetchPage({ url })).rejects.toThrow();
  expect(fetchFn).not.toHaveBeenCalled();
  expect(publicWebUrl("https://github.com/a?q=normal#secret-fragment")).toBe(
    "https://github.com/a?q=normal",
  );
});

it("sends only minimal authenticated JSON and returns bounded safe summaries", async () => {
  const fetchFn = respond({
    results: [result, { ...result, url: "http://localhost/private" }],
  });
  const client = new DeepSeekWebClient(config, fetchFn);
  const output = await client.search({ query: "DeepSeek site:github.com" });
  const [url, request] = fetchFn.mock.calls[0];
  expect(url).toBe("https://api.deepseek.com/v1/tools/search");
  expect(request).toMatchObject({
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  expect(JSON.parse(request!.body as string)).toEqual({
    query: "DeepSeek site:github.com",
    count: 5,
    need_content: false,
  });
  expect(output).toMatchObject({
    results: [{ title: result.title, summary: result.summary, date: null }],
    omitted: 1,
    truncated: false,
  });
  expect(JSON.stringify(output)).not.toContain("DO_NOT_RETURN");
  expect(JSON.stringify(output)).not.toContain("tracker");
  expect(JSON.stringify(output)).not.toContain(config.apiKey);
});

it("invokes native-style fetch without an illegal receiver", async () => {
  const nativeStyle = vi.fn(function (this: unknown) {
    if (this !== undefined) throw new TypeError("Illegal invocation");
    return Promise.resolve(Response.json({ results: [] }));
  });
  await new DeepSeekWebClient(config, nativeStyle).search({ query: "test" });
  expect(nativeStyle).toHaveBeenCalledOnce();
});

it("reports the timeout clearly and never retries an aborted request", async () => {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  const fn = vi.fn<typeof fetch>(async (_url, init) => {
    queueMicrotask(() => timeout.abort());
    return new Promise((_resolve, reject) =>
      init!.signal!.addEventListener(
        "abort",
        () => reject(init!.signal!.reason),
        { once: true },
      ),
    );
  });
  await expect(
    new DeepSeekWebClient(config, fn).search({ query: "test" }),
  ).rejects.toThrow("timed out after 25 seconds");
  expect(fn).toHaveBeenCalledOnce();
});

it("treats empty search as normal, validates response schema, and bounds summary output", async () => {
  const fetchFn = respond({ results: [] });
  const client = new DeepSeekWebClient(config, fetchFn);
  expect((await client.search({ query: "none" })).results).toEqual([]);
  fetchFn.mockImplementationOnce(async () =>
    Response.json({ results: [{ bad: 1 }] }),
  );
  await expect(client.search({ query: "test" })).rejects.toThrow(
    "invalid search results",
  );
  fetchFn.mockImplementationOnce(async () =>
    Response.json({ results: [{ ...result, summary: "x".repeat(2000) }] }),
  );
  const out = await client.search({ query: "test" });
  expect(out.truncated).toBe(true);
  expect(out.results[0].summary).toHaveLength(1600);
});

it("fetches Markdown with source URL, strips fragments and marks truncation", async () => {
  const fetchFn = respond({
    title: "Docs",
    content: "x".repeat(MAX_CONTENT + 10),
  });
  const client = new DeepSeekWebClient(config, fetchFn);
  const out = await client.fetchPage({ url: result.url + "#section" });
  expect(out).toMatchObject({
    title: "Docs",
    url: result.url,
    truncated: true,
  });
  expect(out.content).toHaveLength(MAX_CONTENT);
  expect(fetchFn.mock.calls[0][0]).toBe(
    "https://api.deepseek.com/v1/tools/fetch",
  );
  expect(JSON.parse(fetchFn.mock.calls[0][1]!.body as string)).toEqual({
    url: result.url,
  });
});

it("does not retry permanent errors or expose response bodies / credentials", async () => {
  for (const status of [400, 401, 402, 403, 404]) {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(config.apiKey, { status }),
    );
    await expect(
      new DeepSeekWebClient(config, fetchFn).search({ query: "test" }),
    ).rejects.not.toThrow(config.apiKey);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  }
  const broken = vi.fn<typeof fetch>(async () => {
    throw new TypeError(config.apiKey);
  });
  await expect(
    new DeepSeekWebClient(config, broken).search({ query: "test" }),
  ).rejects.toThrow("invalid response");
});

it("retries transient errors only once", async () => {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("unavailable", { status: 429 }))
    .mockResolvedValueOnce(Response.json({ results: [] }));
  await new DeepSeekWebClient(config, fetchFn).search({ query: "test" });
  expect(fetchFn).toHaveBeenCalledTimes(2);
  const down = vi.fn<typeof fetch>(
    async () => new Response("down", { status: 503 }),
  );
  await expect(
    new DeepSeekWebClient(config, down).search({ query: "test" }),
  ).rejects.toThrow("503");
  expect(down).toHaveBeenCalledTimes(2);
});

it("honors cancellation before and during fetch, and enforces a response byte limit", async () => {
  const controller = new AbortController();
  const fn = respond({ results: [] });
  controller.abort();
  await expect(
    new DeepSeekWebClient(config, fn).search({ query: "x" }, controller.signal),
  ).rejects.toThrow();
  expect(fn).not.toHaveBeenCalled();
  const active = new AbortController();
  const slow = vi.fn<typeof fetch>(async (_u, init) => {
    queueMicrotask(() => active.abort());
    return new Promise((_resolve, reject) =>
      init!.signal!.addEventListener(
        "abort",
        () => reject(init!.signal!.reason),
        { once: true },
      ),
    );
  });
  await expect(
    new DeepSeekWebClient(config, slow).search({ query: "x" }, active.signal),
  ).rejects.toThrow();
  expect(slow).toHaveBeenCalledTimes(1);
  const big = respond({ title: "big", content: "x".repeat(2 * 1024 * 1024) });
  await expect(
    new DeepSeekWebClient(config, big).fetchPage({ url: result.url }),
  ).rejects.toThrow("2 MiB");
});

it("caps parallel calls and preserves counts across approvals but resets on new user turns", async () => {
  const messages: any[] = [
    { role: "user", parts: [{ type: "text", text: "search" }] },
    {
      role: "assistant",
      parts: [
        { type: "tool-web_search" },
        { type: "dynamic-tool", toolName: "web_search" },
        { type: "tool-web_fetch" },
        { type: "tool-click", state: "approval-responded" },
      ],
    },
  ];
  expect(webUsage(messages)).toEqual({ web_search: 2, web_fetch: 1 });
  const fetchFn = respond({ results: [] });
  const tools = createWebTools(settings, messages, fetchFn);
  const execute = tools.web_search.execute! as any;
  const calls = await Promise.allSettled([
    execute({ query: "a", count: 5 }, opts),
    execute({ query: "b", count: 5 }, opts),
  ]);
  expect(calls.map((c) => c.status)).toEqual(["fulfilled", "rejected"]);
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(webUsage([...messages, { role: "user", parts: [] } as any])).toEqual({
    web_search: 0,
    web_fetch: 0,
  });
});

it("renders native expandable source cards, escapes untrusted text and avoids remote icons", () => {
  const html = renderToStaticMarkup(
    <ToolPart
      onApproval={() => {}}
      part={{
        type: "tool-web_search",
        input: { query: "DeepSeek" },
        state: "output-available",
        output: {
          results: [
            { ...result, title: "<script>bad</script>", siteName: "DeepSeek" },
          ],
          truncated: true,
        },
      }}
    />,
  );
  expect(html).toContain("1 sources");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("MCP");
  expect(html).not.toContain("<img");
  expect(html).toContain('rel="noreferrer noopener"');
  expect(html).toContain("Content truncated");
  const error = renderToStaticMarkup(
    <ToolPart
      onApproval={() => {}}
      part={{
        type: "tool-web_fetch",
        state: "output-error",
        errorText: "Fetch failed",
      }}
    />,
  );
  expect(error).toContain("Fetch failed");
});
