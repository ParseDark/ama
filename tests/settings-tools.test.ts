import { it, expect } from "vitest";
import type { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import {
  SETTINGS_TOOLS,
  createSettingsTools,
  describeSettingsChange,
  nameFromUrl,
} from "@/lib/settings-tools";
import {
  DEFAULT_SETTINGS,
  getEmbeddingConfig,
  getMcpServers,
  settingsStore,
  type Settings,
} from "@/lib/settings";
import { LocalChatTransport } from "@/lib/local-chat-transport";
import { buildInstructions } from "@/lib/prompt";

const base = (): Settings => structuredClone(DEFAULT_SETTINGS);
function memoryStore(initial: Settings = base()) {
  let current = structuredClone(initial);
  const saved: Settings[] = [];
  return {
    load: async () => structuredClone(current),
    save: async (s: Settings) => {
      current = structuredClone(s);
      saved.push(structuredClone(s));
    },
    settings: () => current,
    saved,
    reset: (s: Settings) => {
      current = structuredClone(s);
    },
  };
}
const connected = async () => ({ ok: true, toolCount: 18 });
const offline = async () => ({ ok: false, error: "401 Unauthorized" });
const make = (
  store = memoryStore(),
  testServer: () => Promise<{
    ok: boolean;
    toolCount?: number;
    error?: string;
  }> = connected,
) =>
  createSettingsTools({
    load: store.load,
    save: store.save,
    testServer: testServer as any,
    newId: () => "new-id",
  }) as any;

it("names a server from its URL, keeping local and numeric hosts distinct", () => {
  expect(nameFromUrl("https://recap-service.example.com/mcp")).toBe(
    "Recap Service",
  );
  expect(nameFromUrl("https://www.my_notes.example.com/mcp")).toBe("My Notes");
  expect(nameFromUrl("http://localhost:12315/mcp")).toBe("localhost:12315");
  expect(nameFromUrl("http://127.0.0.1:3000/mcp")).toBe("127.0.0.1:3000");
});

it("reads settings without exposing stored secrets", async () => {
  const store = memoryStore({
    ...base(),
    providers: {
      ...base().providers,
      "openai-compatible": {
        ...base().providers["openai-compatible"],
        apiKey: "sk-chat-secret",
      },
    },
    mcpServers: [
      {
        id: "docs",
        name: "Docs",
        url: "https://example.com/mcp",
        token: "mcp-token-secret",
        headers: { "X-Key": "header-secret" },
        enabled: true,
      },
    ],
    embedding: {
      ...getEmbeddingConfig(base()),
      enabled: true,
      token: "embedding-secret",
    },
  });
  const out = await make(store).get_settings.execute({});
  const text = JSON.stringify(out);
  for (const secret of [
    "sk-chat-secret",
    "mcp-token-secret",
    "header-secret",
    "embedding-secret",
  ])
    expect(text).not.toContain(secret);
  expect(out).toMatchObject({
    model: { provider: "openai-compatible", model: "claude-haiku-5-5" },
    mcpServers: [
      {
        name: "Docs",
        url: "https://example.com/mcp",
        enabled: true,
        hasToken: true,
      },
    ],
    embeddings: { enabled: true, url: "http://127.0.0.1:8765/v1" },
    note: "API keys and base URLs can only be seen and changed in Settings.",
  });
  expect(out.models).toContainEqual({
    provider: "openai-compatible",
    models: ["claude-haiku-5-5"],
  });
});

it("adds an MCP server after a successful connection and derives its name", async () => {
  const store = memoryStore();
  const tools = make(store);
  const out = await tools.add_mcp_server.execute({
    url: "https://recap-service.example.com/mcp",
  });
  expect(out).toMatchObject({
    ok: true,
    connected: true,
    toolCount: 18,
    server: {
      name: "Recap Service",
      url: "https://recap-service.example.com/mcp",
      enabled: true,
      hasToken: false,
    },
  });
  const saved = getMcpServers(store.settings()).find(
    (s) => s.name === "Recap Service",
  );
  expect(saved).toMatchObject({
    id: "new-id",
    name: "Recap Service",
    url: "https://recap-service.example.com/mcp",
    token: "",
    enabled: true,
  });
});

it("saves an unreachable server switched off with the connection error", async () => {
  const store = memoryStore();
  const out = await make(store, offline).add_mcp_server.execute({
    name: "Recap",
    url: "https://recap-service.example.com/mcp",
  });
  expect(out).toMatchObject({
    ok: true,
    connected: false,
    error: "401 Unauthorized",
    server: { name: "Recap", enabled: false },
  });
  expect(
    getMcpServers(store.settings()).find((s) => s.name === "Recap"),
  ).toMatchObject({ enabled: false });
});

it("updates the token for the same URL instead of adding a duplicate", async () => {
  const store = memoryStore();
  const tools = make(store);
  const url = "https://recap-service.example.com/mcp";
  await tools.add_mcp_server.execute({ name: "Recap", url });
  const out = await tools.add_mcp_server.execute({ url, token: "new-token" });
  expect(out.server).toMatchObject({ name: "Recap", hasToken: true });
  const recap = getMcpServers(store.settings()).filter((s) => s.url === url);
  expect(recap).toHaveLength(1);
  expect(recap[0].token).toBe("new-token");
});

it("rejects non-http URLs in the schema and in execute", async () => {
  const tools = make();
  expect(
    (tools.add_mcp_server.inputSchema as z.ZodType).safeParse({
      url: "file:///etc/passwd",
    }).success,
  ).toBe(false);
  expect(
    (await tools.add_mcp_server.execute({ url: "file:///etc/passwd" })).ok,
  ).toBe(false);
});

it("requires approval for every write but not for reading", async () => {
  const tools = make();
  expect(tools.get_settings.needsApproval).toBeFalsy();
  for (const name of SETTINGS_TOOLS.filter((n) => n !== "get_settings"))
    expect(tools[name].needsApproval).toBe(true);
  expect(describeSettingsChange("add_mcp_server", { url: "u" })).toBe(
    "Add MCP server u",
  );
  expect(
    describeSettingsChange("update_mcp_server", {
      server: "Recap",
      enabled: false,
    }),
  ).toBe("Change MCP server “Recap”: switch off");
  expect(describeSettingsChange("update_mcp_server", { server: "Recap" })).toBe(
    "Change MCP server “Recap”: no changes",
  );
  expect(
    describeSettingsChange("add_mcp_server", {
      name: "Recap",
      url: "u",
      token: "secret-token-value",
    }),
  ).not.toContain("secret-token-value");
});

it("updates by name and removes by URL", async () => {
  const store = memoryStore();
  const tools = make(store);
  const url = "https://example.com/mcp";
  await tools.add_mcp_server.execute({ name: "Docs", url });
  const updated = await tools.update_mcp_server.execute({
    server: "Docs",
    enabled: false,
  });
  expect(updated).toMatchObject({
    ok: true,
    server: { name: "Docs", enabled: false },
    note: "Its tools are available from the next message.",
  });
  expect(
    getMcpServers(store.settings()).find((s) => s.name === "Docs")?.enabled,
  ).toBe(false);
  expect(
    (
      await tools.update_mcp_server.execute({
        server: "Missing",
        enabled: true,
      })
    ).error,
  ).toContain('No MCP server matches "Missing".');
  expect(await tools.remove_mcp_server.execute({ server: url })).toEqual({
    ok: true,
    removed: "Docs",
  });
  expect(getMcpServers(store.settings()).some((s) => s.name === "Docs")).toBe(
    false,
  );
});

it("switches only to a configured model and lists the choices on failure", async () => {
  const store = memoryStore();
  const settings = store.settings();
  settings.providers.openai.apiKey = "sk-test";
  settings.providers.openai.models = ["gpt-5", "other"];
  store.reset(settings);
  const tools = make(store);
  expect(
    (await tools.switch_model.execute({ provider: "openai", model: "other" }))
      .ok,
  ).toBe(true);
  expect(store.settings().provider).toBe("openai");
  expect(store.settings().providers.openai.model).toBe("other");
  store.reset(settings);
  const out = await tools.switch_model.execute({ model: "nope" });
  expect(out.ok).toBe(false);
  expect(out.error).toContain(`"nope" isn't one of the configured models.`);
  expect(out.error).toContain("openai: gpt-5, other");
  expect(store.settings().provider).toBe("openai-compatible");
});

it("keeps the rest of the embedding endpoint when toggling embeddings", async () => {
  const store = memoryStore();
  const settings = store.settings();
  settings.embedding = {
    enabled: false,
    url: "http://127.0.0.1:9999/v1",
    model: "custom",
    token: "embed-secret",
    dimensions: 512,
    minScore: 0.4,
  };
  store.reset(settings);
  expect(await make(store).set_embeddings.execute({ enabled: true })).toEqual({
    ok: true,
    enabled: true,
  });
  expect(getEmbeddingConfig(store.settings())).toMatchObject({
    enabled: true,
    url: "http://127.0.0.1:9999/v1",
    model: "custom",
    token: "embed-secret",
    dimensions: 512,
    minScore: 0.4,
  });
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const streamModel = () =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          c.enqueue({ type: "text-start", id: "t" });
          c.enqueue({ type: "text-delta", id: "t", delta: "Hi" });
          c.enqueue({ type: "text-end", id: "t" });
          c.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
          });
          c.close();
        },
      }),
    }),
  });
const send = async (transport: LocalChatTransport) => {
  const stream = await transport.sendMessages({
    chatId: "c",
    trigger: "submit-message",
    messages: [
      { id: "u", role: "user", parts: [{ type: "text", text: "Hello" }] },
    ],
  } as any);
  for await (const _ of stream) {
  }
};
const settings = async () => structuredClone(DEFAULT_SETTINGS);

it("offers the settings tools only when settings writes are wired", async () => {
  const model = streamModel();
  const transport = new LocalChatTransport({
    loadSettings: settings,
    saveSettings: async (s) => {
      await settingsStore.setValue(s);
    },
    readActivePage: async () => null,
    createModel: async () => model as any,
  });
  await send(transport);
  const call: any = model.doStreamCalls[0];
  expect(call.tools.map((t: any) => t.name)).toEqual(
    expect.arrayContaining(["get_settings", "add_mcp_server", "switch_model"]),
  );
  expect(JSON.stringify(call.prompt)).toContain("add_mcp_server");

  const without = streamModel();
  const plain = new LocalChatTransport({
    loadSettings: settings,
    readActivePage: async () => null,
    createModel: async () => without as any,
  });
  await send(plain);
  expect(
    without.doStreamCalls[0]!.tools?.map((t: any) => t.name) ?? [],
  ).not.toContain("add_mcp_server");
});

it("adds the settings guide to both prompt variants", () => {
  for (const prompt of [
    buildInstructions(null),
    buildInstructions({
      tabId: 1,
      url: "https://example.com",
      title: "Example",
      markdown: "PAGE",
      selection: "",
      elements: [],
      truncated: false,
    }),
  ])
    expect(prompt).toContain("add_mcp_server");
});
