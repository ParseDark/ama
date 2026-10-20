import { it, expect, vi } from "vitest";
import { listModels, listModelsWithInfo, modelInfoOf } from "@/lib/list-models";
const config = { apiKey: "key", baseURL: "http://local", model: "x" };
it("sorts and dedupes model ids", async () => {
  expect(
    await listModels(
      "openai",
      config,
      vi.fn(async () =>
        Response.json({ data: [{ id: "z" }, { id: "a" }, { id: "a" }] }),
      ),
    ),
  ).toEqual(["a", "z"]);
});
it("paginates Anthropic with browser header", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ data: [{ id: "b" }], last_id: "b", has_more: true }),
    )
    .mockResolvedValueOnce(
      Response.json({ data: [{ id: "a" }], has_more: false }),
    );
  expect(await listModels("anthropic", config, f)).toEqual(["a", "b"]);
  expect(f.mock.calls[1][0]).toContain("after_id=b");
  expect(
    f.mock.calls[0][1].headers["anthropic-dangerous-direct-browser-access"],
  ).toBe("true");
});
it("filters and paginates Google generation models", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        models: [
          {
            name: "models/embedding",
            supportedGenerationMethods: ["embedContent"],
          },
          { name: "models/a", supportedGenerationMethods: ["generateContent"] },
        ],
        nextPageToken: "next",
      }),
    )
    .mockResolvedValueOnce(Response.json({ models: [] }));
  expect(await listModels("google", config, f)).toEqual(["a"]);
  expect(f.mock.calls[1][0]).toContain("pageToken=next");
});
it("includes status and capped error text", async () => {
  await expect(
    listModels(
      "openai",
      config,
      vi.fn(async () => new Response("denied", { status: 403 })),
    ),
  ).rejects.toThrow("Listing models failed with 403: denied");
});

it("parses the gateway limits and USD-per-Mtok prices", async () => {
  const gateway = {
    data: [
      {
        id: "claude-haiku-5-5",
        max_input_tokens: 100000,
        capabilities: { max_output_tokens: 128000 },
        pricing: {
          input: 0.1,
          output: 0.5,
          cache_read: 0.01,
          cache_write: 0.125,
          cache_write_1h: 0.2,
          unit: "usd_per_mtok",
          threshold: 100000,
          long: {
            input: 0.5,
            output: 2.5,
            cache_read: 0.05,
            cache_write: 0.625,
            cache_write_1h: 1,
          },
        },
      },
      { id: "no-info" },
    ],
  };
  const result = await listModelsWithInfo(
    "openai-compatible",
    config,
    vi.fn(async () => Response.json(gateway)),
  );
  expect(result.models).toEqual(["claude-haiku-5-5", "no-info"]);
  expect(result.info).toEqual({
    "claude-haiku-5-5": {
      maxInputTokens: 100000,
      maxOutputTokens: 128000,
      pricing: {
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
      },
    },
  });
});

it("maps Google and alternative context fields", () => {
  expect(
    modelInfoOf({
      name: "models/gemini",
      inputTokenLimit: 1000000,
      outputTokenLimit: 8192,
    }),
  ).toEqual({ maxInputTokens: 1000000, maxOutputTokens: 8192 });
  expect(
    modelInfoOf({ id: "x", context_length: 200000, max_output_tokens: 4096 }),
  ).toEqual({ maxInputTokens: 200000, maxOutputTokens: 4096 });
  expect(modelInfoOf({ id: "x", context_window: 32000 })).toEqual({
    maxInputTokens: 32000,
  });
  expect(modelInfoOf({ id: "x", max_input_tokens: 0 })).toBeUndefined();
  expect(
    modelInfoOf({
      id: "x",
      pricing: { input: 1, output: 2, unit: "usd_per_1m" },
    }),
  ).toBeUndefined();
});

it("parses context_length/max_tokens (including numeric strings) and nested limits", () => {
  expect(
    modelInfoOf({
      id: "qwen",
      context_length: "128000",
      max_tokens: "32000",
    }),
  ).toEqual({ maxInputTokens: 128000, maxOutputTokens: 32000 });
  expect(
    modelInfoOf({
      id: "nested",
      capabilities: {
        max_input_tokens: 100000,
        max_output_tokens: 8000,
      },
    }),
  ).toEqual({ maxInputTokens: 100000, maxOutputTokens: 8000 });
  expect(
    modelInfoOf({
      id: "limits",
      limits: { context_window: 64000, max_output_tokens: 4096 },
    }),
  ).toEqual({ maxInputTokens: 64000, maxOutputTokens: 4096 });
});

it("accepts an array or models wrapper from compatible gateways", async () => {
  const array = await listModelsWithInfo(
    "openai-compatible",
    config,
    vi.fn(async () => Response.json([{ id: "a", context_length: 1000 }])),
  );
  expect(array).toEqual({
    models: ["a"],
    info: { a: { maxInputTokens: 1000 } },
  });
  const wrapped = await listModelsWithInfo(
    "openai-compatible",
    config,
    vi.fn(async () =>
      Response.json({ models: [{ id: "b", max_tokens: 2000 }] }),
    ),
  );
  expect(wrapped).toEqual({
    models: ["b"],
    info: { b: { maxOutputTokens: 2000 } },
  });
});

it("falls back to the models.dev snapshot when /models omits limits", async () => {
  const result = await listModelsWithInfo(
    "openai-compatible",
    { ...config, baseURL: "https://api.qnaigc.com/v1" },
    vi.fn(async () => Response.json({ data: [{ id: "claude-haiku-5-5" }] })),
  );
  expect(result.info["claude-haiku-5-5"]).toMatchObject({
    maxInputTokens: 1000000,
    maxOutputTokens: 128000,
    source: "models.dev",
  });
  expect(result.info["claude-haiku-5-5"].pricing).toBeUndefined();
});

it("prefers the gateway's limit over the catalog and fills missing prices", async () => {
  const result = await listModelsWithInfo(
    "openai-compatible",
    config,
    vi.fn(async () =>
      Response.json({
        data: [
          {
            id: "claude-haiku-5-5",
            max_input_tokens: 100000,
            capabilities: { max_output_tokens: 128000 },
          },
        ],
      }),
    ),
  );
  expect(result.info["claude-haiku-5-5"]).toMatchObject({
    maxInputTokens: 100000,
    maxOutputTokens: 128000,
  });
  expect(result.info["claude-haiku-5-5"].source).toBeUndefined();
});
