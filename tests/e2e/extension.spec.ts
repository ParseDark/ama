import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
const DEFAULT_SETTINGS = {
  provider: "openai-compatible",
  providers: {
    "openai-compatible": { apiKey: "", baseURL: "", model: "" },
    openai: { apiKey: "", baseURL: "", model: "gpt-5" },
    anthropic: { apiKey: "", baseURL: "", model: "claude-sonnet-5-5" },
    google: { apiKey: "", baseURL: "", model: "gemini-2.5-flash" },
  },
};
let context: BrowserContext,
  panel: Page,
  site: Page,
  sw: Worker,
  server: Server,
  base: string;
let requests: any[] = [];
let embeddingRequests: any[] = [],
  mcpCalls: string[] = [];
const mcpHttpHeaders: Record<string, string | string[] | undefined>[] = [];
let learning = false,
  manyTools = false,
  embeddingsDown = false,
  recapMcp = false;
const axis = (text: string) =>
  /jira|sprint/i.test(text)
    ? [1, 0, 0, 0]
    : /workday|vacation/i.test(text)
      ? [0, 1, 0, 0]
      : /kafka|retry|重试/i.test(text)
        ? [0, 0, 1, 0]
        : [0, 0, 0, 1];
const dataPipelineQuery =
  "Process a large dataset using stored data references";
const dataPipelineTail = "UNPREVIEWED-DATA-TAIL-9f71c2";
const form = `<!doctype html><title>Test checkout</title><main><h1>Test checkout</h1><p>Lookup code is ALPHA-42. This page contains a form to exercise browser actions.</p><form onsubmit="event.preventDefault();document.querySelector('#result').textContent='Submitted '+document.querySelector('#name').value"><label>Name<input id="name" placeholder="Full name"></label><label>Region<select><option value="us">United States</option><option value="uk">United Kingdom</option></select></label><label><input type="checkbox">Updates</label><button>Send order</button></form><p id="result"></p></main>`;
function completion(res: any, content: any, stream: boolean) {
  const message = typeof content === "string" ? { content } : content;
  if (!stream) {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        id: "mock",
        object: "chat.completion",
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", ...message },
            finish_reason: message.tool_calls ? "tool_calls" : "stop",
          },
        ],
      }),
    );
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  const chunk = (delta: any, finish_reason: any = null) =>
    res.write(
      `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  chunk({ role: "assistant" });
  const usageChunk = (prompt: number, completion: number) =>
    res.write(
      `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } })}\n\n`,
    );
  if (message.content === "Slow generation metrics test") {
    chunk({ content: "Slow streaming response" });
    const timer = setTimeout(() => {
      chunk({}, "stop");
      res.end("data: [DONE]\\n\\n");
    }, 10000);
    res.on("close", () => clearTimeout(timer));
    return;
  }
  if (message.content === "Generation metrics test") {
    setTimeout(() => {
      chunk({ content: "Generation " });
      setTimeout(() => {
        chunk({ content: "metrics test" });
        chunk({}, "stop");
        res.write(
          `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [], usage: { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 } })}\n\n`,
        );
        res.end("data: [DONE]\\n\\n");
      }, 120);
    }, 80);
    return;
  }
  if (message.content === "Context meter test") {
    chunk({ content: "Context answer" });
    chunk({}, "stop");
    usageChunk(1200, 4);
    usageChunk(0, 50);
    res.end("data: [DONE]\n\n");
    return;
  }
  if (message.content === "Full context test") {
    chunk({ content: "Full answer" });
    chunk({}, "stop");
    usageChunk(96950, 4);
    usageChunk(0, 50);
    res.end("data: [DONE]\n\n");
    return;
  }
  chunk(message);
  chunk({}, message.tool_calls ? "tool_calls" : "stop");
  res.end("data: [DONE]\n\n");
}
function tool(name: string, args: any) {
  return {
    tool_calls: [
      {
        index: 0,
        id: "call-" + Date.now(),
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}
function idFor(body: any, label: string) {
  return (
    /\[(e\d+)\]/.exec(
      body.messages[0].content
        .split("\n")
        .find((l: string) => l.includes(label)) ?? "",
    )?.[1] ?? "e1"
  );
}
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.url === "/mcp" && req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/models") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          data: [
            {
              id: "test-model",
              max_input_tokens: 100000,
              capabilities: { max_output_tokens: 128000 },
              pricing: {
                input: 1,
                output: 5,
                cache_read: 0.01,
                cache_write: 0.125,
                unit: "usd_per_mtok",
                threshold: 100000,
                long: {
                  input: 2,
                  output: 10,
                  cache_read: 0.02,
                  cache_write: 0.25,
                },
              },
            },
            { id: "test-other" },
          ],
        }),
      );
      return;
    }
    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        req.url === "/tall"
          ? "<!doctype html><title>Tall page</title><style>body{margin:0}header{position:sticky;top:0;height:70px;background:red}main{height:3930px;background:linear-gradient(white,blue)}</style><header>Sticky once</header><main>Tall page</main>"
          : form,
      );
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (req.url === "/embeddings") {
      embeddingRequests.push(body);
      if (embeddingsDown) {
        res.writeHead(503);
        res.end("unavailable");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          data: body.input.map((t: string, index: number) => ({
            index,
            embedding: axis(t),
          })),
        }),
      );
      return;
    }
    if (req.url === "/mcp") {
      mcpHttpHeaders.push({ ...req.headers });
      if (!body.id) {
        res.writeHead(202);
        res.end();
        return;
      }
      let result: any = {};
      if (body.method === "initialize")
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "Notes", version: "1" },
          instructions: "Notes contains sprint tasks.",
        };
      if (body.method === "tools/list")
        result = {
          tools: [
            {
              name: "get_notes",
              description: "Read notes",
              inputSchema: { type: "object", properties: {} },
              annotations: { readOnlyHint: true },
            },
            {
              name: "write_note",
              description: "Write a note",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
              annotations: { destructiveHint: true },
            },
          ],
        };
      if (body.method === "tools/list" && manyTools)
        result.tools = Array.from({ length: 15 }, (_, i) => ({
          name: `get_${i < 3 ? "jira" : "other"}_${i}`,
          description: i < 3 ? "Jira sprint task" : "Unrelated note",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true },
        }));
      if (body.method === "tools/list" && recapMcp)
        result.tools = [
          {
            name: "list_recaps",
            description: "List recaps",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true },
          },
          {
            name: "get_recap",
            description: "Get a recap",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
            annotations: { readOnlyHint: true },
          },
        ];
      if (body.method === "tools/call") {
        mcpCalls.push(body.params.name);
        result = { content: [{ type: "text", text: "notes ok" }] };
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      return;
    }
    requests.push(body);
    const users = body.messages.filter((m: any) => m.role === "user"),
      last = users.at(-1),
      q =
        typeof last?.content === "string"
          ? last.content
          : (last?.content?.find((p: any) => p.type === "text")?.text ?? "");
    const afterTool = body.messages.at(-1)?.role === "tool";
    let reply: any =
      q === "Measure generation performance"
        ? "Generation metrics test"
        : q === "Stop performance test"
          ? "Slow generation metrics test"
          : q === "Measure context window"
            ? "Context meter test"
            : q === "Fill context window"
              ? "Full context test"
              : "**Grounded answer**: ALPHA-42";
    if (body.messages[0].content.includes("Decide whether"))
      reply = tool("answer", {
        asksToRemember: /remember|记住|以后用/.test(q),
      });
    else if (body.messages[0].content.includes("Compare a new memory")) {
      const english = q.includes("New memory: Reply in English");
      const ids =
        q
          .split("Existing memories:\n")[1]
          ?.split("\n")
          .map((l: string) => l.split(":")[0]) ?? [];
      reply = tool("answer", {
        relations: ids.map((id: string) => ({
          id,
          relation:
            id === "zh" ? (english ? "contradicts" : "duplicate") : "different",
        })),
      });
    } else if (body.messages[0].content.includes("Label each saved memory"))
      reply = tool("answer", { items: [] });
    else if (body.messages[0].content.includes("maintain a short list"))
      reply = tool("answer", {
        ops: learning
          ? [
              {
                op: "add",
                text: "Prefers short answers",
                kind: "inferred",
                reason: "Repeated requests for brevity",
              },
            ]
          : [],
      });
    else if (q === "DeepSeek public web lookup") {
      const calls = body.messages
        .filter((m: any) => m.role === "assistant")
        .flatMap((m: any) => m.tool_calls ?? []);
      const fetched = calls.some((c: any) => c.function.name === "web_fetch");
      const searched = calls.some((c: any) => c.function.name === "web_search");
      reply = fetched
        ? "Verified [DeepSeek docs](https://api-docs.deepseek.com/guides/search)."
        : searched
          ? tool("web_fetch", {
              url: "https://api-docs.deepseek.com/guides/search",
            })
          : tool("web_search", { query: "DeepSeek Search docs", count: 5 });
    } else if (q === dataPipelineQuery) {
      const calls = body.messages
        .filter((m: any) => m.role === "assistant")
        .flatMap((m: any) => m.tool_calls ?? [])
        .filter((c: any) => c.function.name === "run_js");
      const lastTool = () =>
        JSON.parse(
          body.messages.filter((m: any) => m.role === "tool").at(-1).content,
        );
      if (!calls.length)
        reply = tool("run_js", {
          // Split the sentinel so only real data can introduce the full marker.
          code: `export default async function() {
            const marker = "UNPREVIEWED-" + "DATA-TAIL-9f71c2";
            return Array.from({ length: 12000 }, (_, index) => ({
              index,
              value: index * 7 + 3,
              marker: index === 11999 ? marker : "row-" + index,
            }));
          }`,
          input: null,
        });
      else if (calls.length === 1)
        reply = tool("run_js", {
          code: `export default async function({ data }) {
            const rows = data.rows;
            return { count: rows.length, tail: rows.at(-1).marker };
          }`,
          data: { rows: lastTool().result.dataId },
        });
      else {
        const { count, tail } = lastTool().result.preview;
        reply = `Data pipeline complete: ${count} rows, tail ${tail}`;
      }
    } else if (!afterTool && q.startsWith("Danger read tab "))
      reply = tool("read_tab", { tab: Number(q.split(" ").at(-1)) });
    else if (!afterTool && q === "Danger forget password")
      reply = tool("forget", { query: "password" });
    else if (!afterTool && q === "remember: My password is example-test-only")
      reply = tool("remember", { text: "My password is example-test-only" });
    else if (!afterTool && q === "Recall my private account reference")
      reply = tool("recall_memory", { query: "Private reference" });
    else if (!afterTool && q.includes("以后用英文"))
      reply = tool("remember", { text: "Reply in English" });
    else if (!afterTool && q.includes("记住 用中文"))
      reply = tool("remember", { text: "用中文回答" });
    else if (!afterTool && q.includes("remember link"))
      reply = tool("remember", {
        text: "Jira board https://example.com/jira",
        category: "reference",
        topic: "Jira",
      });
    else if (!afterTool && q.includes("像上次那样"))
      reply = tool("search_history", { query: "Kafka retry" });
    else if (q === "workspace preview batch") {
      const calls = body.messages
        .filter((m: any) => m.role === "assistant")
        .flatMap((m: any) => m.tool_calls ?? []);
      const operations: [string, any][] = [
        [
          "create_file",
          {
            path: "preview-one.md",
            content:
              "# Preview one\nSAFE <script>window.BAD_PREVIEW=true</script>\n",
          },
        ],
        [
          "edit_file",
          {
            path: "sample.txt",
            edits: [{ oldText: "PATCHED-99", newText: "BATCH-100" }],
          },
        ],
        ["create_file", { path: "preview-three.txt", content: "third file\n" }],
        [
          "edit_file",
          {
            path: "preview-one.md",
            edits: [{ oldText: "Preview one", newText: "Preview final" }],
          },
        ],
      ];
      reply =
        calls.length < operations.length
          ? tool(...operations[calls.length])
          : "Batch files complete.";
    } else if (!afterTool && q.startsWith("workspace ")) {
      const operation = q.slice("workspace ".length);
      const calls: Record<string, [string, any]> = {
        list: ["list_files", {}],
        read: ["read_file", { path: "sample.txt" }],
        search: ["search_files", { query: "LOCAL-42" }],
        create: [
          "create_file",
          { path: "created.txt", content: "created content\n" },
        ],
        edit: [
          "edit_file",
          {
            path: "sample.txt",
            edits: [{ oldText: "LOCAL-42", newText: "LOCAL-99" }],
          },
        ],
        patch: [
          "patch_file",
          {
            path: "sample.txt",
            patch:
              "--- sample.txt\n+++ sample.txt\n@@ -1 +1 @@\n-LOCAL-99\n+PATCHED-99\n",
          },
        ],
        delete: ["delete_file", { path: "created.txt" }],
        sensitive: ["read_file", { path: ".env" }],
      };
      const [name, args] = calls[operation];
      reply = tool(name, args);
    } else if (!afterTool && q.includes("select region"))
      reply = tool("select", {
        id: idFor(body, 'select "Region"'),
        option: "United Kingdom",
      });
    else if (!afterTool && q.includes("check updates"))
      reply = tool("check", {
        id: idFor(body, 'input type=checkbox "Updates"'),
        checked: true,
      });
    else if (!afterTool && q.includes("read other tab")) {
      const tabs = await sw.evaluate(async () =>
        (globalThis as any).chrome.tabs.query({}),
      );
      const other = tabs.find((t: any) => t.url === base + "/other-user");
      reply = tool("read_tab", { tab: other.id });
    } else if (q.includes("lookup in background")) {
      const calls = body.messages
        .filter((m: any) => m.role === "assistant")
        .flatMap((m: any) => m.tool_calls ?? []);
      const results = body.messages
        .filter((m: any) => m.role === "tool")
        .map((m: any) => JSON.parse(m.content));
      const start = Number(
        /<page tab="(\d+)"/.exec(body.messages[0].content)?.[1],
      );
      if (!calls.length)
        reply = tool("plan", {
          steps: [
            { title: "Lookup", status: "in_progress" },
            { title: "Fill form", status: "pending" },
          ],
        });
      else if (calls.length === 1)
        reply = tool("open_tab", { url: base + "/lookup" });
      else if (calls.length === 2)
        reply = tool("fill", {
          tab: start,
          id: idFor(body, 'input "Name"'),
          text: "ALPHA-42",
        });
      else if (calls.length === 3)
        reply = tool("close_tab", {
          tab: results.find((r: any) => r.url === base + "/lookup").tabId,
        });
      else if (calls.length === 4)
        reply = tool("plan", {
          steps: [
            { title: "Lookup", status: "done" },
            { title: "Fill form", status: "done" },
          ],
        });
      else reply = "Lookup complete.";
    } else if (!afterTool && q.includes("配置"))
      reply = tool("add_mcp_server", {
        url: base + "/mcp",
        name: "Recap",
        token: "recap-secret-token",
      });
    else if (!afterTool && q.includes("关掉"))
      reply = tool("update_mcp_server", { server: "Recap", enabled: false });
    else if (!afterTool && q.includes("切换到"))
      reply = tool("switch_model", { model: "test-other" });
    else if (!afterTool && q.includes("read MCP"))
      reply = tool("notes_get_notes", {});
    else if (!afterTool && q.includes("write MCP"))
      reply = tool("notes_write_note", { text: "Hello notes" });
    else if (!afterTool && q.includes("save doubtful"))
      reply = tool("remember", { text: "Prefers hidden page rules" });
    else if (!afterTool && q.includes("save foreign"))
      reply = tool("remember", {
        text: "Check https://foreign.example.com/board",
        category: "reference",
        topic: "Foreign",
      });
    else if (!afterTool && q.includes("remember site"))
      reply = tool("remember", {
        text: "Use site-specific bullets",
        scope: "site",
      });
    else if (!afterTool && q.includes("fill name"))
      reply = tool("fill", { id: idFor(body, 'input "Name"'), text: "Ada" });
    else if (!afterTool && q.includes("submit order"))
      reply = tool("click", { id: idFor(body, "Send order") });
    else if (!afterTool && q.includes("remember"))
      reply = tool("remember", {
        text: "Reply in concise bullet points",
        scope: "global",
        category: "preference",
      });
    else if (!afterTool && q.includes("highlight name"))
      reply = tool("highlight", {
        id: idFor(body, 'input "Name"'),
        note: "Your full name goes here",
      });
    completion(res, reply, body.stream === true);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const args = [
    "--disable-extensions-except=" + resolve(".output/chrome-mv3"),
    "--load-extension=" + resolve(".output/chrome-mv3"),
  ];
  context = await chromium.launchPersistentContext("", {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : { channel: "chromium" }),
    headless: true,
    args,
    viewport: { width: 800, height: 800 },
  });
  sw =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers["openai-compatible"] = {
    apiKey: "",
    baseURL: base,
    model: "test-model",
  };
  await sw.evaluate(
    (s) => (globalThis as any).chrome.storage.local.set({ settings: s }),
    settings,
  );
  site = await context.newPage();
  await site.goto(base);
  panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 800 });
  await panel.goto(sw.url().replace("background.js", "sidepanel.html"));
  await site.bringToFront();
});
test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});
async function send(text: string) {
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill(text);
  await panel.getByRole("button", { name: "Send", exact: true }).click();
}
async function clear() {
  const button = panel.getByRole("button", {
    name: "Clear chat (⌥⇧L)",
    exact: true,
  });
  if (await button.isEnabled()) await button.click();
  await expect(
    panel.getByRole("heading", { name: "Ask about this page" }),
  ).toBeVisible();
}
test("grounded streaming, copy, model fetching, history and reload", async () => {
  await send("What is the lookup code?");
  await expect(
    panel.getByText("Grounded answer", { exact: false }),
  ).toBeVisible();
  expect(requests.at(-1).messages[0].content).toContain("ALPHA-42");
  await expect(panel.getByLabel("Generation statistics")).toContainText("TTFT");
  await expect(panel.getByLabel("Generation statistics")).toContainText(
    "Speed —",
  );
  await expect(
    panel.getByRole("button", { name: "Copy", exact: true }),
  ).toHaveCount(1);
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("button", { name: "Fetch", exact: true }).click();
  await expect(panel.getByText(/2 models/)).toBeVisible();
  const settingsPicker = panel.getByRole("combobox", {
    name: "Choose model",
    exact: true,
  });
  await settingsPicker.click();
  await panel
    .getByRole("combobox", { name: "Search models", exact: true })
    .fill("test-other");
  await expect(
    panel.getByRole("option", { name: "test-model", exact: true }),
  ).toHaveCount(0);
  await panel.getByRole("option", { name: "test-other", exact: true }).click();
  await expect(settingsPicker).toContainText("test-other");
  await settingsPicker.click();
  await panel
    .getByRole("combobox", { name: "Search models", exact: true })
    .fill("custom/model|beta");
  await panel
    .getByRole("option", { name: /Use “custom\/model\|beta”/ })
    .click();
  await expect(settingsPicker).toContainText("custom/model|beta");
  await settingsPicker.click();
  await panel
    .getByRole("combobox", { name: "Search models", exact: true })
    .fill("not-saved");
  await panel.keyboard.press("Escape");
  await expect(settingsPicker).toContainText("custom/model|beta");
  await panel.reload();
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    panel.getByRole("combobox", { name: "Choose model", exact: true }),
  ).toContainText("custom/model|beta");
  await panel.getByRole("button", { name: "Back to chat" }).click();
  await expect(
    panel.getByRole("combobox", { name: "Choose model", exact: true }),
  ).toContainText("custom/model|beta");
  await panel.getByRole("combobox", { name: "Choose model" }).click();
  await expect(
    panel.getByRole("combobox", { name: "Search models", exact: true }),
  ).toHaveValue("");
  await panel.getByRole("option", { name: "test-other", exact: true }).click();
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await send("Second model chat");
  await expect(
    panel.getByText("Grounded answer", { exact: false }),
  ).toBeVisible();
  expect(requests.filter((r) => r.stream).at(-1).model).toBe("test-other");
  await panel.reload();
  await expect(
    panel.getByText("Grounded answer", { exact: false }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Chats", exact: true }).click();
  await expect(
    panel
      .locator(".history-list")
      .getByText("What is the lookup code?", { exact: true }),
  ).toBeVisible();
  await expect(panel.locator(".history-list li").first()).toContainText(
    "Second model chat",
  );
  await panel
    .locator(".history-list")
    .getByText("What is the lookup code?", { exact: true })
    .click();
  await expect(panel.locator(".message-user")).toContainText(
    "What is the lookup code?",
  );
  await panel.getByRole("button", { name: "Chats", exact: true }).click();
  await panel
    .getByRole("button", { name: "Delete chat Second model chat", exact: true })
    .click();
  await expect(
    panel
      .locator(".history-list")
      .getByText("Second model chat", { exact: true }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "Back to chat" }).click();
});
test("new and cleared chats keep immediately typed text while deletion is delayed", async () => {
  await panel.evaluate(() => {
    const area = (globalThis as any).chrome.storage.local;
    const original = area.remove;
    (globalThis as any).__restoreRemove = () => {
      area.remove = original;
    };
    area.remove = (keys: unknown) =>
      new Promise((resolve, reject) =>
        setTimeout(
          () =>
            Promise.resolve(original.call(area, keys)).then(resolve, reject),
          1000,
        ),
      );
  });
  try {
    const textbox = panel.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await panel.getByRole("button", { name: "New chat", exact: true }).click();
    await textbox.fill("Immediate new chat input");
    await panel.waitForTimeout(1300);
    await expect(textbox).toHaveValue("Immediate new chat input");
    await panel
      .getByRole("button", { name: "Clear chat (⌥⇧L)", exact: true })
      .click();
    await textbox.fill("Immediate cleared chat input");
    await panel.waitForTimeout(1300);
    await expect(textbox).toHaveValue("Immediate cleared chat input");
  } finally {
    await panel.evaluate(() => (globalThis as any).__restoreRemove());
  }
});
test("highlight, safe fill, real approval label and original tab on resume", async () => {
  await clear();
  await site.bringToFront();
  await send("highlight name");
  await expect(
    panel.getByText("Your full name goes here", { exact: true }),
  ).toBeVisible();
  await expect(site.locator("#ama-highlight")).toBeVisible();
  await expect(site.locator("#name")).toBeFocused();
  await site.locator("#ama-highlight").evaluate((e) => e.remove());
  await panel
    .getByRole("button", { name: "Your full name goes here", exact: true })
    .click();
  await expect(site.locator("#ama-highlight")).toBeVisible();
  await send("fill name");
  await expect(site.locator("#name")).toHaveValue("Ada");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await send("submit order");
  await expect(
    panel.getByRole("group", { name: "Approval required" }),
  ).toContainText("Send order");
  const other = await context.newPage();
  await other.goto(base + "/other");
  await other.bringToFront();
  await panel.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(site.locator("#result")).toHaveText("Submitted Ada");
  await expect(other.locator("#result")).toHaveText("");
  const stats = panel.getByLabel("Generation statistics").last();
  await stats.locator("summary").click();
  await expect(stats).toContainText("2 requests · complete");
  await other.close();
});
test("explicit memory persists, injects, metadata survives reload and clear shortcut", async () => {
  await clear();
  await site.bringToFront();
  await send("remember: Reply in concise bullet points");
  await expect(
    panel.getByText("Remembered: Reply in concise bullet points", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await send("What is the lookup code?");
  await expect(panel.getByText("Used 1 memories")).toBeVisible();
  const prompt = requests.at(-1).messages[0].content;
  expect(prompt.indexOf("<user_memory>")).toBeLessThan(
    prompt.indexOf("<page "),
  );
  await panel.reload();
  await expect(panel.getByText("Used 1 memories")).toBeVisible();
  await panel
    .getByRole("textbox", { name: "Message", exact: true })
    .press("Alt+Shift+L");
  await expect(
    panel.getByRole("heading", { name: "Ask about this page" }),
  ).toBeVisible();
});

test("select/check, denied submit, background lookup plan and user-tab approval", async () => {
  await clear();
  await site.bringToFront();
  await send("select region");
  await expect(site.locator("select")).toHaveValue("uk");
  await send("check updates");
  await expect(site.locator("input[type=checkbox]")).toBeChecked();
  await site.locator("#result").evaluate((e) => (e.textContent = ""));
  await send("submit order");
  await panel.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(panel.getByText(/Skipped: click/)).toBeVisible();
  await expect(site.locator("#result")).toHaveText("");
  await clear();
  await send("lookup in background");
  await expect(site.locator("#name")).toHaveValue("ALPHA-42");
  await expect(panel.getByText("Lookup complete.")).toBeVisible();
  await expect(panel.getByRole("group", { name: "Plan" })).toContainText("2/2");
  expect(context.pages().some((p) => p.url() === base + "/lookup")).toBe(false);
  const other = await context.newPage();
  await other.goto(base + "/other-user");
  await site.bringToFront();
  await send("read other tab");
  await expect(
    panel.getByRole("group", { name: "Approval required" }),
  ).toContainText("Test checkout");
  await panel.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(panel.getByText(/Skipped: read_tab/)).toBeVisible();
  expect(other.isClosed()).toBe(false);
  await other.close();
});

test("screenshots attach as images and full-page capture restores page state", async () => {
  await clear();
  await site.goto(base + "/tall");
  await site.bringToFront();
  await site.evaluate(() => scrollTo(0, 500));
  await panel.getByRole("button", { name: "Attach screenshot" }).click();
  await panel.getByRole("menuitem", { name: "Full page", exact: true }).click();
  const image = panel.getByAltText("Screenshot 1");
  await expect(image).toBeVisible({ timeout: 20000 });
  const size = await image.evaluate((el: HTMLImageElement) => ({
    width: el.naturalWidth,
    height: el.naturalHeight,
  }));
  expect(size.height).toBeGreaterThan(3500);
  expect(size.width).toBeLessThanOrEqual(1280);
  expect(await site.evaluate(() => scrollY)).toBe(500);
  expect(
    await site
      .locator(
        "[data-ama-capture],[data-ama-prev-visibility],[data-ama-capture-hidden]",
      )
      .count(),
  ).toBe(0);
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    panel.getByText("Grounded answer", { exact: false }),
  ).toBeVisible();
  expect(
    requests
      .at(-1)
      .messages.find((m: any) => m.role === "user")
      .content.some((p: any) => p.type === "image_url"),
  ).toBe(true);
  await clear();
  await site.goto(base);
  await site.bringToFront();
  await panel.getByRole("button", { name: "Attach screenshot" }).click();
  await panel
    .getByRole("menuitem", { name: "Visible area", exact: true })
    .click();
  await expect(image).toBeVisible();
  await panel.getByRole("button", { name: "Remove screenshot 1" }).click();
  await expect(image).toHaveCount(0);
  await site.goto(base + "/tall");
  await site.bringToFront();
  await site.evaluate(() => scrollTo(0, 400));
  await panel.getByRole("button", { name: "Attach screenshot" }).click();
  await panel.getByRole("menuitem", { name: "Full page", exact: true }).click();
  await expect.poll(() => site.locator("[data-ama-capture]").count()).toBe(1);
  const other = await context.newPage();
  await other.goto(base + "/switched");
  await other.bringToFront();
  await expect(panel.getByRole("alert")).toContainText(
    "active tab changed during capture",
  );
  expect(await site.evaluate(() => scrollY)).toBe(400);
  await expect(
    site.locator(
      "[data-ama-capture],[data-ama-prev-visibility],[data-ama-capture-hidden]",
    ),
  ).toHaveCount(0);
  await other.close();
  await site.goto(base);
  await site.bringToFront();
});

test("MCP connects, offers read tools and approves writes", async () => {
  await clear();
  mcpCalls = [];
  await sw.evaluate(async (url) => {
    const c = (globalThis as any).chrome;
    const { settings } = await c.storage.local.get("settings");
    settings.mcpServers = [
      {
        id: "notes",
        name: "Notes",
        url: url + "/mcp",
        token: "",
        enabled: true,
      },
    ];
    await c.storage.local.set({ settings });
  }, base);
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "Tools", exact: true }).click();
  await panel
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(panel.getByText("Connected · 2 tools")).toBeVisible();
  await panel.getByRole("button", { name: "Back to chat" }).click();
  await site.bringToFront();
  await send("read MCP");
  await expect(
    panel.getByText("Notes · get_notes", { exact: true }),
  ).toBeVisible();
  expect(mcpCalls).toEqual(["get_notes"]);
  await send("write MCP");
  await expect(
    panel.getByRole("group", { name: "Approval required" }),
  ).toContainText("Let Notes run write_note?");
  await expect(
    panel.getByRole("group", { name: "Approval required" }),
  ).toContainText("Hello notes");
  await panel.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(
    panel.getByText("Notes · write_note", { exact: true }),
  ).toBeVisible();
  expect(mcpCalls).toEqual(["get_notes", "write_note"]);
  expect(requests.filter((r) => r.stream).at(-1).messages[0].content).toContain(
    "Notes contains sprint tasks.",
  );
});

test("doubtful and foreign saves can be declined; memory controls disable injection", async () => {
  await clear();
  await site.bringToFront();
  await send("save doubtful");
  await expect(
    panel.getByRole("group", { name: "Approval required" }),
  ).toContainText("You didn't ask to save this.");
  await panel.getByRole("button", { name: "Don't save", exact: true }).click();
  await send("save foreign");
  await expect(
    panel.getByRole("group", { name: "Approval required" }),
  ).toContainText("link you didn't type");
  await panel.getByRole("button", { name: "Don't save", exact: true }).click();
  const readMemory = () =>
    sw.evaluate(
      async () =>
        (await (globalThis as any).chrome.storage.local.get("memory")).memory
          ?.memories ?? [],
    );
  expect(
    (await readMemory()).some(
      (m: any) => m.text.includes("hidden") || m.text.includes("foreign"),
    ),
  ).toBe(false);
  await send("remember site");
  await expect(
    panel.getByText("Remembered: Use site-specific bullets", { exact: true }),
  ).toBeVisible();
  expect(
    (await readMemory()).find(
      (m: any) => m.text === "Use site-specific bullets",
    ).scope,
  ).toBe("domain:127.0.0.1");
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "Memory", exact: true }).click();
  await panel
    .getByRole("button", { name: "Manage memories", exact: true })
    .click();
  await panel.getByRole("switch", { name: "Use memory", exact: true }).click();
  await panel.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    panel.getByRole("tab", { name: "Memory", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("button", { name: "Back to chat" }).click();
  await send("What is the lookup code?");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  expect(
    requests.filter((r) => r.stream).at(-1).messages[0].content,
  ).not.toContain("Use site-specific bullets");
});

test("sensitive explicit memory confirms, persists as a reference and recalls on demand", async () => {
  await clear();
  // The previous scenario deliberately disables memory; restore this test's
  // prerequisites instead of depending on execution order.
  await sw.evaluate(async () => {
    const s = (globalThis as any).chrome.storage.local;
    const { memory, settings } = await s.get(["memory", "settings"]);
    await s.set({
      memory: { ...memory, enabled: true },
      settings: {
        ...settings,
        embedding: { ...settings.embedding, enabled: false },
      },
    });
  });
  await panel.reload();
  await site.bringToFront();
  await send("remember: My password is example-test-only");
  const approval = panel.getByRole("group", { name: "Approval required" });
  await expect(approval).toContainText("sensitive information");
  await expect(approval).toContainText("without encryption");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    panel.getByText("Remembered: My password is example-test-only", {
      exact: true,
    }),
  ).toBeVisible();
  const saved = await sw.evaluate(
    async () =>
      (await (globalThis as any).chrome.storage.local.get("memory")).memory
        .memories,
  );
  expect(
    saved.find((m: any) => m.text === "My password is example-test-only"),
  ).toMatchObject({ category: "reference", topic: "Private reference" });
  await panel.reload();
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await send("What is the lookup code?");
  expect(
    requests.filter((r) => r.stream).at(-1).messages[0].content,
  ).not.toContain("example-test-only");
  await send("Recall my private account reference");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  const answer = requests.filter((r) => r.stream).at(-1);
  expect(
    JSON.stringify(answer.messages.filter((m: any) => m.role === "tool")),
  ).toContain("example-test-only");
});

test("reference retrieval shares query embedding and semantic history search works", async () => {
  await clear();
  embeddingRequests = [];
  await sw.evaluate(async (base) => {
    const c = (globalThis as any).chrome;
    const { settings } = await c.storage.local.get("settings");
    settings.embedding = {
      enabled: true,
      url: base,
      model: "toy",
      token: "",
      dimensions: 4,
      minScore: 0.28,
    };
    const now = Date.now();
    const mem = (id: string, text: string, category: string) => ({
      id,
      text,
      category,
      scope: "global",
      kind: "explicit",
      evidence: 1,
      confidence: 1,
      lastSeen: now,
      createdAt: now,
    });
    await c.storage.local.set({
      settings,
      memory: {
        schemaVersion: 1,
        enabled: true,
        memories: [
          mem("pref", "Use concise answers", "preference"),
          mem(
            "jira",
            "Jira sprint board https://example.com/jira",
            "reference",
          ),
          mem("work", "Workday vacation portal", "reference"),
        ],
      },
    });
  }, base);
  await send("Where is the sprint board?");
  await expect(panel.getByText("Used 2 memories")).toBeVisible();
  const prompt = requests.filter((r) => r.stream).at(-1).messages[0].content;
  expect(prompt).toContain("Jira sprint board");
  expect(prompt).not.toContain("Workday vacation portal");
  expect(
    embeddingRequests.filter((r) => r.input_type === "query"),
  ).toHaveLength(1);
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await send("Kafka retry plan");
  await expect(
    panel.getByText("Grounded answer", { exact: false }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await send("Weekend ideas");
  await expect(
    panel.getByText("Grounded answer", { exact: false }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Chats", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "Search chats", exact: true })
    .fill("上次消息重试方案");
  await expect(panel.locator(".history-hit").first()).toContainText(
    "Kafka retry plan",
  );
  await panel.locator(".history-hit").first().click();
  await expect(panel.locator(".message-user")).toContainText(
    "Kafka retry plan",
  );
});

test("learning suggests repeated habits without assistant/page data and confirmation activates", async () => {
  await clear();
  learning = true;
  await sw.evaluate(async () => {
    const c = (globalThis as any).chrome;
    const { settings } = await c.storage.local.get("settings");
    settings.embedding.enabled = false;
    settings.providers["openai-compatible"].models = [
      "claude-haiku-5-5",
      "test-model",
    ];
    await c.storage.local.set({
      settings,
      memory: { schemaVersion: 1, enabled: true, memories: [] },
      memoryLearning: { cursors: {}, eventCursor: 0, runs: 0, lastRunAt: 0 },
    });
  });
  await send("Always keep answers short");
  await expect(
    panel.getByText("Grounded answer", { exact: false }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await expect
    .poll(() =>
      sw.evaluate(
        async () =>
          (await (globalThis as any).chrome.storage.local.get("memory")).memory
            .memories.length,
      ),
    )
    .toBe(1);
  await send("Please be brief again");
  await expect(
    panel.getByText("Grounded answer", { exact: false }),
  ).toBeVisible();
  await sw.evaluate(async () => {
    const c = (globalThis as any).chrome;
    const { memoryLearning } = await c.storage.local.get("memoryLearning");
    await c.storage.local.set({
      memoryLearning: { ...memoryLearning, lastRunAt: 0 },
    });
  });
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(
    panel.getByText("Prefers short answers", { exact: true }),
  ).toBeVisible();
  const extraction = requests
    .filter((r) => r.messages?.[0]?.content?.includes("maintain a short list"))
    .at(-1);
  expect(extraction.model).toBe("claude-haiku-5-5");
  expect(extraction.messages[1].content).not.toContain("ALPHA-42");
  await panel.getByRole("button", { name: "Remember", exact: true }).click();
  await send("Hello");
  await expect(panel.getByText("Used 1 memories")).toBeVisible();
  learning = false;
});

test("semantic contradictions undo, paraphrases reinforce and similar memories merge", async () => {
  await clear();
  await sw.evaluate(async (base) => {
    const c = (globalThis as any).chrome;
    const { settings } = await c.storage.local.get("settings");
    settings.embedding = {
      enabled: true,
      url: base,
      model: "toy",
      dimensions: 4,
      minScore: 0.28,
      token: "",
    };
    const n = Date.now();
    const m = (id: string, text: string) => ({
      id,
      text,
      kind: "explicit",
      category: "preference",
      scope: "global",
      evidence: 1,
      confidence: 1,
      lastSeen: n,
      createdAt: n,
    });
    await c.storage.local.set({
      settings,
      memory: {
        schemaVersion: 1,
        enabled: true,
        memories: [
          m("zh", "Reply in Chinese"),
          m("a", "Use bullet points"),
          m("b", "Prefer bulleted answers"),
        ],
      },
    });
  }, base);
  await site.bringToFront();
  await send("以后用英文回答");
  await expect(
    panel.getByText(
      'Remembered: Reply in English (replaces "Reply in Chinese")',
      { exact: true },
    ),
  ).toBeVisible();
  const memories = () =>
    sw.evaluate(
      async () =>
        (await (globalThis as any).chrome.storage.local.get("memory")).memory
          .memories,
    );
  expect((await memories()).find((m: any) => m.id === "zh").disabled).toBe(
    true,
  );
  await panel.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () => !!(await memories()).find((m: any) => m.id === "zh").disabled,
    )
    .toBe(false);
  await send("记住 用中文回答");
  await expect(
    panel.getByText("Already remembered: Reply in Chinese", { exact: true }),
  ).toBeVisible();
  expect((await memories()).find((m: any) => m.id === "zh").evidence).toBe(2);
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "Memory", exact: true }).click();
  await panel
    .getByRole("button", { name: "Manage memories", exact: true })
    .click();
  const pair = panel
    .getByRole("group", { name: "Similar pair" })
    .filter({ hasText: "A · Use bullet points" })
    .filter({ hasText: "B · Prefer bulleted answers" });
  await expect(pair).toBeVisible();
  await pair.getByRole("button", { name: "Keep A", exact: true }).click();
  await expect
    .poll(async () => (await memories()).some((m: any) => m.id === "b"))
    .toBe(false);
  expect((await memories()).find((m: any) => m.id === "a").evidence).toBe(2);
  await panel
    .getByRole("button", { name: 'Stop using "Reply in Chinese"', exact: true })
    .click();
  await panel
    .getByRole("button", { name: 'Delete "Use bullet points"', exact: true })
    .click();
  await expect(panel.getByRole("list", { name: "Memories" })).not.toContainText(
    "Use bullet points",
  );
  await panel.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    panel.getByRole("tab", { name: "Memory", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("button", { name: "Back to chat" }).click();
  await send("Hello after disabling");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  expect(
    requests.filter((r) => r.stream).at(-1).messages[0].content,
  ).not.toContain("Reply in Chinese");
});

test("typed references, history tool, retrieval fallback and large MCP filtering", async () => {
  await clear();
  await send("remember link https://example.com/jira");
  await expect(
    panel.getByText("Remembered: Jira board https://example.com/jira", {
      exact: true,
    }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Undo", exact: true }).click();
  await clear();
  await send("Kafka retry plan");
  await expect(
    panel.getByText("Grounded answer", { exact: false }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await send("像上次那样…");
  await expect(
    panel.getByText("Searched earlier chats", { exact: true }),
  ).toBeVisible();
  const toolResult = requests
    .filter((r) => r.stream)
    .at(-1)
    .messages.findLast((m: any) => m.role === "tool");
  expect(JSON.parse(toolResult.content).results[0].answer).toContain(
    "ALPHA-42",
  );
  await sw.evaluate(async (base) => {
    const c = (globalThis as any).chrome;
    const { settings } = await c.storage.local.get("settings");
    settings.mcpServers = [
      {
        id: "many",
        name: "Many",
        url: base + "/mcp",
        token: "",
        enabled: true,
      },
    ];
    const n = Date.now();
    await c.storage.local.set({
      settings,
      memory: {
        schemaVersion: 1,
        enabled: true,
        memories: [
          {
            id: "ref",
            text: "Jira sprint reference",
            topic: "Jira",
            category: "reference",
            kind: "explicit",
            scope: "global",
            evidence: 1,
            confidence: 1,
            lastSeen: n,
            createdAt: n,
          },
        ],
      },
    });
  }, base);
  manyTools = true;
  embeddingRequests = [];
  await clear();
  await send("Jira sprint tasks");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  const req = requests.filter((r) => r.stream).at(-1),
    names = req.tools.map((t: any) => t.function.name);
  expect(names.filter((n: string) => n.startsWith("many_"))).toHaveLength(8);
  expect(names).toEqual(
    expect.arrayContaining([
      "many_get_jira_0",
      "many_get_jira_1",
      "many_get_jira_2",
      "plan",
      "highlight",
      "fill",
      "select",
      "check",
      "click",
      "read_tab",
      "open_tab",
      "list_tabs",
      "switch_tab",
      "close_tab",
      "remember",
      "forget",
      "recall_memory",
      "search_history",
    ]),
  );
  expect(
    embeddingRequests.filter((r) => r.input_type === "query"),
  ).toHaveLength(1);
  embeddingsDown = true;
  await send("Jira sprint tasks again");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  expect(requests.filter((r) => r.stream).at(-1).messages[0].content).toContain(
    "Saved references (call recall_memory",
  );
  embeddingsDown = false;
  manyTools = false;
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "Memory", exact: true }).click();
  await panel
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(panel.getByText(/Connected · 4 dims/)).toBeVisible();
  await panel.getByRole("button", { name: "Back to chat" }).click();
});

test("copy feedback, panel shortcuts, alarm learning and no-new-signals guard", async () => {
  await clear();
  await send("A copyable answer");
  await expect(
    panel.getByRole("button", { name: "Copy", exact: true }),
  ).toHaveCount(1);
  const before = await sw.evaluate(
    async () =>
      (await (globalThis as any).chrome.storage.local.get("memoryEvents"))
        .memoryEvents ?? [],
  );
  await panel.evaluate(() => {
    (window as any).__copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          (window as any).__copied = t;
        },
      },
    });
  });
  await panel.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  expect(await panel.evaluate(() => (window as any).__copied)).toBe(
    "**Grounded answer**: ALPHA-42",
  );
  expect(
    await sw.evaluate(
      async () =>
        (await (globalThis as any).chrome.storage.local.get("memoryEvents"))
          .memoryEvents ?? [],
    ),
  ).toEqual(before);
  const textbox = panel.getByRole("textbox", { name: "Message", exact: true });
  await panel.reload();
  await expect(textbox).toBeFocused();
  await panel.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          (window as any).__copied = t;
        },
      },
    });
  });
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "Model", exact: true }).click();
  const apiKey = panel.locator('input[type="password"]').first();
  await apiKey.focus();
  await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(apiKey).toBeFocused();
  await panel.getByRole("button", { name: "Back to chat" }).click();
  await expect(textbox).toBeFocused();
  const chats = panel.getByRole("button", { name: "Chats", exact: true });
  await chats.focus();
  await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(chats).toBeFocused();
  await panel.evaluate(() => {
    (window as any).__originalClose = window.close;
    (window as any).__shortcutCloses = 0;
    window.close = () => {
      (window as any).__shortcutCloses++;
    };
  });
  try {
    await textbox.press("Meta+k");
    expect(await panel.evaluate(() => (window as any).__shortcutCloses)).toBe(
      0,
    );
    await textbox.press("Control+k");
    expect(await panel.evaluate(() => (window as any).__shortcutCloses)).toBe(
      1,
    );
  } finally {
    await panel.evaluate(() => {
      window.close = (window as any).__originalClose;
    });
  }
  const toggleKey = await sw.evaluate(
    () =>
      (globalThis as any).chrome.runtime.getManifest().commands["toggle-panel"]
        .suggested_key,
  );
  expect(toggleKey).toEqual({ default: "Ctrl+K", mac: "MacCtrl+K" });
  await textbox.press("Meta+l");
  await expect(panel.locator(".message-user")).toHaveCount(1);
  await textbox.press("Meta+Shift+l");
  await expect(
    panel.getByRole("heading", { name: "Ask about this page" }),
  ).toBeVisible();
  const commands = await sw.evaluate(async () =>
    (globalThis as any).chrome.commands.getAll(),
  );
  expect(commands.find((c: any) => c.name === "clear-chat")).toBeDefined();
  const suggested = await sw.evaluate(
    () =>
      (globalThis as any).chrome.runtime.getManifest().commands["clear-chat"]
        .suggested_key,
  );
  expect(suggested).toEqual({ default: "Ctrl+Shift+L", mac: "Alt+Shift+L" });
  // Linux headless Chromium may leave OS-level bindings unassigned. Panel
  // keyboard delivery is exercised above; verify assigned bindings on macOS.
  if (process.platform === "darwin")
    expect(
      commands.find((c: any) => c.name === "clear-chat").shortcut,
    ).toContain("L");
  await send("Alarm learned preference");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await sw.evaluate(async () => {
    const c = (globalThis as any).chrome;
    const { settings } = await c.storage.local.get("settings");
    settings.embedding.enabled = false;
    await c.storage.local.set({
      settings,
      memoryLearning: { cursors: {}, eventCursor: 0, runs: 0, lastRunAt: 0 },
    });
    await c.alarms.create("memory-learn-soon", { when: Date.now() + 150 });
  });
  await expect
    .poll(() =>
      sw.evaluate(
        async () =>
          (await (globalThis as any).chrome.storage.local.get("memoryLearning"))
            .memoryLearning.runs,
      ),
    )
    .toBe(1);
  await sw.evaluate(async () => {
    const c = (globalThis as any).chrome;
    const { memoryLearning } = await c.storage.local.get("memoryLearning");
    await c.storage.local.set({
      memoryLearning: { ...memoryLearning, lastRunAt: 0 },
    });
  });
  const count = () =>
    requests.filter((r) =>
      r.messages?.[0]?.content?.includes("maintain a short list"),
    ).length;
  const prior = count();
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await panel.waitForTimeout(400);
  expect(count()).toBe(prior);
});

test("generation timings show real usage, persist after reload and stay outside copied text", async () => {
  await clear();
  await send("Measure generation performance");
  await expect(
    panel.getByRole("button", { name: "Copy", exact: true }),
  ).toBeVisible();
  const stats = panel.getByLabel("Generation statistics");
  await expect(stats).toContainText("tok/s");
  await expect(stats).not.toContainText("TTFT —");
  await stats.locator("summary").click();
  await expect(stats).toContainText("Input 120 · Output 24");
  await expect(stats).toContainText("1 request · complete");
  expect(requests.filter((r) => r.stream).at(-1).stream_options).toEqual({
    include_usage: true,
  });
  await panel.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await panel.evaluate(() => (window as any).__copied)).toBe(
    "Generation metrics test",
  );
  await panel.reload();
  await expect(panel.getByLabel("Generation statistics")).toContainText(
    "tok/s",
  );
  await panel.getByLabel("Generation statistics").locator("summary").click();
  await expect(panel.getByLabel("Generation statistics")).toContainText(
    "Input 120 · Output 24",
  );
});

test("stopped replies retain partial timings instead of claiming complete usage", async () => {
  await clear();
  await send("Stop performance test");
  await expect(
    panel.getByText("Slow streaming response", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  const stats = panel.getByLabel("Generation statistics");
  await stats.locator("summary").click();
  await expect(stats).toContainText("stopped");
  await expect(stats).toContainText("Partial / awaiting provider usage");
  await expect(stats).toContainText("Speed —");
  await panel.reload();
  await panel.getByLabel("Generation statistics").locator("summary").click();
  await expect(panel.getByLabel("Generation statistics")).toContainText(
    "stopped",
  );
});

test("default workspace tools use real file handles, worker search, approvals and conflict checks", async () => {
  await clear();
  await send("workspace list");
  await expect(
    panel.getByText(/No workspace connected/, { exact: false }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  // Real browser FileSystemHandles backed by OPFS, not mock IO. Native chooser
  // and OS-directory permission persistence still require manual acceptance.
  await panel.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("ama-test-workspace", {
      create: true,
    });
    for (const [name, text] of [
      ["sample.txt", "LOCAL-42\n"],
      [".env", "DO_NOT_READ"],
      [".gitignore", "ignored.txt\n"],
      ["ignored.txt", "LOCAL-42"],
    ]) {
      const f = await dir.getFileHandle(name, { create: true }),
        stream = await f.createWritable();
      await stream.write(text);
      await stream.close();
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("ama-files", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(
        { id: "e2e-workspace", handle: dir },
        "current",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  const read = (name: string) =>
    panel.evaluate(async (name) => {
      const dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("ama-test-workspace");
      try {
        return await (await (await dir.getFileHandle(name)).getFile()).text();
      } catch {
        return null;
      }
    }, name);
  await clear();
  await send("workspace read");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  expect(
    requests
      .at(-1)
      .messages.some(
        (m: any) => m.role === "tool" && m.content.includes("LOCAL-42"),
      ),
  ).toBe(true);
  const names = requests.at(-1).tools.map((t: any) => t.function.name);
  for (const name of [
    "list_files",
    "find_files",
    "search_files",
    "read_file",
    "create_file",
    "edit_file",
    "patch_file",
    "delete_file",
  ])
    expect(names).toContain(name);
  await clear();
  await send("workspace search");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  const search = JSON.parse(
    requests.at(-1).messages.find((m: any) => m.role === "tool").content,
  );
  expect(search.matches).toEqual([
    expect.objectContaining({ path: "sample.txt", line: 1, column: 1 }),
  ]);
  await clear();
  await send("workspace sensitive");
  await expect(panel.getByText(/Sensitive paths are blocked/)).toBeVisible();
  const approval = panel.getByRole("group", { name: "Approval required" });
  await clear();
  await send("workspace create");
  await expect(approval.getByLabel("File change preview")).toContainText(
    "+created content",
  );
  expect(await read("created.txt")).toBeNull();
  await approval.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  expect(await read("created.txt")).toBeNull();
  await clear();
  await send("workspace create");
  await approval.getByRole("button", { name: "Allow", exact: true }).click();
  await expect.poll(() => read("created.txt")).toBe("created content\n");
  await expect(
    panel.getByRole("region", { name: "Changed files" }),
  ).toContainText("1 file changed");
  await panel
    .getByRole("button", { name: "Preview created.txt", exact: true })
    .click();
  await expect(panel.getByLabel("File preview content")).toHaveText(
    "created content\n",
  );
  await panel.getByRole("button", { name: "Close file preview" }).click();
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await clear();
  await send("workspace edit");
  await expect(approval.getByLabel("File change preview")).toContainText(
    "+LOCAL-99",
  );
  await approval.getByRole("button", { name: "Allow", exact: true }).click();
  await expect.poll(() => read("sample.txt")).toBe("LOCAL-99\n");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await clear();
  await send("workspace patch");
  await approval.getByRole("button", { name: "Allow", exact: true }).click();
  await expect.poll(() => read("sample.txt")).toBe("PATCHED-99\n");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await clear();
  await send("workspace delete");
  await expect(approval).toBeVisible();
  await panel.evaluate(async () => {
    const dir = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("ama-test-workspace");
    const stream = await (
      await dir.getFileHandle("created.txt")
    ).createWritable();
    await stream.write("external change");
    await stream.close();
  });
  await approval.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(panel.getByText(/File changed since preview/)).toBeVisible();
  expect(await read("created.txt")).toBe("external change");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await clear();
  await send("workspace delete");
  await approval.getByRole("button", { name: "Allow", exact: true }).click();
  await expect.poll(() => read("created.txt")).toBeNull();
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Changed files" }),
  ).toContainText("1 file changed");
  await panel
    .getByRole("button", { name: "Preview created.txt", exact: true })
    .click();
  await expect(panel.getByLabel("File preview content")).toHaveText(
    "external change",
  );
  await expect(panel.getByRole("dialog")).toContainText("Deleted");
  await panel.getByRole("button", { name: "After", exact: true }).click();
  await expect(panel.getByLabel("File preview content")).toHaveText(
    "File was deleted.",
  );
  await panel.getByRole("button", { name: "Close file preview" }).click();
  await clear();
  await send("workspace preview batch");
  for (let i = 0; i < 4; i++) {
    await expect(approval).toBeVisible();
    await approval.getByRole("button", { name: "Allow", exact: true }).click();
    if (i < 3)
      await expect(approval.getByLabel("File change preview")).toBeVisible();
  }
  await expect(
    panel.getByText("Batch files complete.", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Changed files" }),
  ).toContainText("3 files changed");
  await expect(
    panel.getByRole("button", { name: "Preview preview-one.md", exact: true }),
  ).toHaveCount(1);
  // Preview snapshot must be stable even if external disk contents later change.
  await panel.evaluate(async () => {
    const dir = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("ama-test-workspace");
    const stream = await (
      await dir.getFileHandle("preview-one.md")
    ).createWritable();
    await stream.write("EXTERNAL DISK CHANGE");
    await stream.close();
  });
  await panel
    .getByRole("button", { name: "Preview preview-one.md", exact: true })
    .click();
  const preview = panel.getByRole("dialog");
  await expect(panel.getByLabel("File preview content")).toContainText(
    "# Preview final",
  );
  expect(
    await panel.evaluate(() => (window as any).BAD_PREVIEW),
  ).toBeUndefined();
  await preview.getByRole("button", { name: "Before", exact: true }).click();
  await expect(panel.getByLabel("File preview content")).toContainText(
    "did not exist",
  );
  await preview.getByRole("button", { name: "Diff", exact: true }).click();
  await expect(panel.getByLabel("File preview content")).toContainText(
    "+# Preview final",
  );
  const downloadPromise = panel.waitForEvent("download");
  await preview.getByRole("button", { name: "Download", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "preview-one.md.patch",
  );
  await panel.keyboard.press("Escape");
  await expect(preview).not.toBeVisible();
  await panel.reload();
  await expect(
    panel.getByRole("region", { name: "Changed files" }),
  ).toContainText("3 files changed");
  await panel
    .getByRole("button", { name: "Preview preview-one.md", exact: true })
    .click();
  await expect(panel.getByLabel("File preview content")).toContainText(
    "# Preview final",
  );
  await panel.getByRole("button", { name: "Close file preview" }).click();
  await panel.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("ama-file-previews", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  });
  await panel
    .getByRole("button", { name: "Preview preview-one.md", exact: true })
    .click();
  await expect(panel.getByRole("dialog").getByRole("alert")).toContainText(
    "unavailable or expired",
  );
  await panel.getByRole("button", { name: "Close file preview" }).click();
  await clear();
  await send("workspace read");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  expect(
    requests
      .at(-1)
      .messages.some(
        (m: any) => m.role === "tool" && m.content.includes("BATCH-100"),
      ),
  ).toBe(true);
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(panel.getByText("Workspace: ama-test-workspace")).toBeVisible();
  // Simulate Chrome returning prompt for an existing handle; require an actual
  // browser click with user activation, not an automatic model-tool request.
  await panel.evaluate(() => {
    const proto = FileSystemHandle.prototype as any;
    const query = proto.queryPermission,
      request = proto.requestPermission;
    let granted = false;
    proto.queryPermission = function (o: any) {
      return this.name === "ama-test-workspace"
        ? Promise.resolve(o.mode === "read" || granted ? "granted" : "prompt")
        : query.call(this, o);
    };
    proto.requestPermission = function (o: any) {
      if (this.name !== "ama-test-workspace") return request.call(this, o);
      (window as any).__workspaceActivation = navigator.userActivation.isActive;
      granted = true;
      return Promise.resolve("granted");
    };
    (window as any).__restoreWorkspacePermissions = () => {
      proto.queryPermission = query;
      proto.requestPermission = request;
    };
    window.dispatchEvent(new Event("focus"));
  });
  await expect(panel.getByText(/Read: granted · Write: prompt/)).toBeVisible();
  await panel.getByRole("button", { name: "Reauthorize", exact: true }).click();
  await expect(panel.getByText(/Read: granted · Write: granted/)).toBeVisible();
  expect(
    await panel.evaluate(() => (window as any).__workspaceActivation),
  ).toBe(true);
  await panel.evaluate(() => (window as any).__restoreWorkspacePermissions());
  await panel.getByText(/Local recovery backups/).click();
  await expect(
    panel.getByRole("button", { name: "Download backup" }),
  ).toHaveCount(5);
  await panel.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(panel.getByText("Workspace: Not connected")).toBeVisible();
  await panel.getByRole("button", { name: "Back to chat" }).click();
});

test("MCP custom headers save, validate and reach both connection test and tool requests", async () => {
  await sw.evaluate(async (url) => {
    const c = (globalThis as any).chrome;
    const { settings } = await c.storage.local.get("settings");
    settings.mcpServers = [
      {
        id: "notes",
        name: "Notes",
        url: url + "/mcp",
        token: "",
        enabled: true,
      },
    ];
    await c.storage.local.set({ settings });
  }, base);
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "Tools", exact: true }).click();
  const card = panel.getByRole("group", { name: "MCP server Notes" });
  const headers = card.getByRole("textbox", {
    name: "Headers (JSON)",
    exact: true,
  });
  await headers.fill('{"X-API-Key": 123}');
  await expect(card.getByRole("alert")).toContainText("string values");
  await expect(
    card.getByRole("button", { name: "Test connection", exact: true }),
  ).toBeDisabled();
  await headers.fill(
    '{"X-API-Key":"header-test-value","Authorization":"Basic header-test"}',
  );
  await card.locator('input[type="password"]').fill("ignored-bearer");
  const before = mcpHttpHeaders.length;
  await card
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(card.getByRole("status")).toContainText("Connected");
  expect(
    mcpHttpHeaders
      .slice(before)
      .some(
        (h) =>
          h["x-api-key"] === "header-test-value" &&
          h.authorization === "Basic header-test",
      ),
  ).toBe(true);
  await panel.reload();
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(
    panel
      .getByRole("group", { name: "MCP server Notes" })
      .getByRole("textbox", { name: "Headers (JSON)", exact: true }),
  ).toHaveValue(/header-test-value/);
  await panel.getByRole("button", { name: "Back to chat" }).click();
  await clear();
  const toolBefore = mcpHttpHeaders.length;
  await send("read MCP");
  await expect(
    panel.getByText("Notes · get_notes", { exact: true }),
  ).toBeVisible();
  expect(
    mcpHttpHeaders
      .slice(toolBefore)
      .some(
        (h) =>
          h["x-api-key"] === "header-test-value" &&
          h.authorization === "Basic header-test",
      ),
  ).toBe(true);
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  expect(JSON.stringify(requests.at(-1))).not.toContain("header-test-value");
  expect(JSON.stringify(requests.at(-1))).not.toContain("ignored-bearer");
});

test("opt-in config sync includes credentials, follows remote changes and leaves history local", async () => {
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("tab", { name: "Model", exact: true }).click();
  const section = panel.getByRole("region", {
    name: "Configuration sync",
    exact: true,
  });
  await expect(section.getByRole("status")).toContainText("Disabled");
  await sw.evaluate(async () => {
    const c = (globalThis as any).chrome;
    const { settings } = await c.storage.local.get("settings");
    settings.providers.openai.apiKey = "sync-provider-test-secret";
    settings.mcpServers[0].token = "sync-mcp-test-secret";
    settings.mcpServers[0].headers = {
      "X-Test-Key": "sync-header-test-secret",
    };
    settings.embedding = {
      ...settings.embedding,
      token: "sync-embedding-test-secret",
    };
    await c.storage.local.set({ settings });
  });
  panel.once("dialog", (d) => d.accept());
  await section
    .getByRole("button", { name: "Enable · upload this device", exact: true })
    .click();
  await expect(section.getByRole("status")).toContainText(
    "Enabled on this device",
  );
  const decodeCloud = async () =>
    sw.evaluate(async () => {
      const data = await (globalThis as any).chrome.storage.sync.get(null),
        m = data["ama.config.manifest"];
      let encoded = "";
      for (let i = 0; i < m.parts; i++)
        encoded += data[`ama.config.chunk.${m.revision.id}.${i}`];
      const bytes = Uint8Array.from(atob(encoded), (x) => x.charCodeAt(0));
      return JSON.parse(
        await new Response(
          new Blob([bytes])
            .stream()
            .pipeThrough(new DecompressionStream("gzip")),
        ).text(),
      );
    });
  const snapshot = await decodeCloud();
  expect(snapshot.settings.providers.openai.apiKey).toBe(
    "sync-provider-test-secret",
  );
  expect(snapshot.settings.mcpServers[0].token).toBe("sync-mcp-test-secret");
  expect(snapshot.settings.mcpServers[0].headers["X-Test-Key"]).toBe(
    "sync-header-test-secret",
  );
  expect(snapshot.settings.embedding.token).toBe("sync-embedding-test-secret");
  expect(Object.keys(snapshot).sort()).toEqual([
    "memoryEnabled",
    "settings",
    "version",
  ]);
  await sw.evaluate(async () => {
    const c = (globalThis as any).chrome,
      { settings } = await c.storage.local.get("settings");
    settings.providers.openai.apiKey = "sync-provider-new-secret";
    await c.storage.local.set({ settings });
  });
  await expect
    .poll(async () => (await decodeCloud()).settings.providers.openai.apiKey, {
      timeout: 12000,
    })
    .toBe("sync-provider-new-secret");
  await sw.evaluate(async () => {
    const c = (globalThis as any).chrome;
    const data = await c.storage.sync.get(null),
      old = data["ama.config.manifest"];
    let encoded = "";
    for (let i = 0; i < old.parts; i++)
      encoded += data[`ama.config.chunk.${old.revision.id}.${i}`];
    const snapshot = JSON.parse(
      await new Response(
        new Blob([Uint8Array.from(atob(encoded), (x) => x.charCodeAt(0))])
          .stream()
          .pipeThrough(new DecompressionStream("gzip")),
      ).text(),
    );
    snapshot.settings.providers.openai.apiKey = "remote-synced-secret";
    const text = JSON.stringify(snapshot),
      hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
        ),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
    const compressed = new Uint8Array(
      await new Response(
        new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    let raw = "";
    for (const x of compressed) raw += String.fromCharCode(x);
    const contents = btoa(raw);
    const revision = { time: Date.now() + 100000, id: crypto.randomUUID() },
      parts = Math.ceil(contents.length / 7000),
      values: any = {};
    values["ama.config.manifest"] = {
      version: 1,
      revision,
      hash,
      parts,
      encoding: "gzip-base64",
    };
    for (let i = 0; i < parts; i++)
      values[`ama.config.chunk.${revision.id}.${i}`] = contents.slice(
        i * 7000,
        (i + 1) * 7000,
      );
    await c.storage.sync.set(values);
  });
  await expect
    .poll(() =>
      sw.evaluate(
        async () =>
          (await (globalThis as any).chrome.storage.local.get("settings"))
            .settings.providers.openai.apiKey,
      ),
    )
    .toBe("remote-synced-secret");
  await panel.reload();
  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(section.getByRole("status")).toContainText(
    "Enabled on this device",
  );
  await section
    .getByRole("button", { name: "Disable sync", exact: true })
    .click();
  await expect(section.getByRole("status")).toContainText(
    "Disabled on this device",
  );
  expect((await decodeCloud()).settings.providers.openai.apiKey).toBe(
    "remote-synced-secret",
  );
  panel.once("dialog", (d) => d.accept());
  await section
    .getByRole("button", { name: "Clear cloud config", exact: true })
    .click();
  await expect
    .poll(() =>
      sw.evaluate(async () =>
        Object.keys(await (globalThis as any).chrome.storage.sync.get(null)),
      ),
    )
    .toEqual([]);
  expect(
    await sw.evaluate(
      async () =>
        !!(await (globalThis as any).chrome.storage.local.get("sessions"))
          .sessions?.length,
    ),
  ).toBe(true);
  await panel.getByRole("button", { name: "Back to chat" }).click();
});

test("settings buttons retain readable shadcn variants in light and dark themes", async () => {
  await clear();
  const measure = () =>
    panel.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const rgb = (color: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const foreground = rgb(root.getPropertyValue("--foreground"));
      const background = rgb(root.getPropertyValue("--background"));
      const contrast = (a: number[], b: number[]) => {
        const luminance = (c: number[]) =>
          c
            .map((v) => {
              v /= 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const l = [luminance(a), luminance(b)].sort((a, b) => b - a);
        return (l[0] + 0.05) / (l[1] + 0.05);
      };
      return [
        ...document.querySelectorAll<HTMLButtonElement>(
          'button[data-slot="button"]',
        ),
      ]
        .filter((b) => b.getClientRects().length)
        .map((b) => {
          const style = getComputedStyle(b);
          const fg = rgb(style.color);
          const bg =
            style.backgroundColor === "rgba(0, 0, 0, 0)"
              ? background
              : rgb(style.backgroundColor);
          return {
            text: b.textContent?.trim(),
            foreground: fg,
            expectedForeground: foreground,
            background: bg,
            border: rgb(style.borderTopColor),
            borderWidth: style.borderTopWidth,
            radius: parseFloat(style.borderTopLeftRadius),
            fontSize: parseFloat(style.fontSize),
            opacity: Number(style.opacity),
            contrast: contrast(fg, bg),
            height: b.getBoundingClientRect().height,
          };
        });
    });
  for (const colorScheme of ["light", "dark"] as const) {
    await panel.emulateMedia({ colorScheme });
    await panel.getByRole("button", { name: "Settings", exact: true }).click();
    for (const [tab, button] of [
      ["Model", "Fetch"],
      ["Memory", "Manage memories"],
      ["Tools", "Add server"],
    ]) {
      await panel.getByRole("tab", { name: tab, exact: true }).click();
      const visible = panel.getByRole("button", { name: button, exact: true });
      await expect(visible).toBeVisible();
      const styles = await measure();
      const action = styles.find((b) => b.text === button)!;
      expect(action.foreground).toEqual(action.expectedForeground);
      expect(action.contrast).toBeGreaterThanOrEqual(4.5);
      expect(action.height).toBeGreaterThanOrEqual(26);
      expect(action.borderWidth).toBe("1px");
      expect(action.radius).toBeGreaterThan(4);
      expect(action.fontSize).toBeGreaterThanOrEqual(11);
      expect(action.opacity).toBe(1);
      // Neutral shadcn tokens must remain achromatic in both modes.
      for (const color of [action.foreground, action.background, action.border])
        expect(Math.max(...color) - Math.min(...color)).toBeLessThanOrEqual(1);
      await visible.hover();
      await panel.waitForTimeout(200);
      expect(
        (await measure()).find((b) => b.text === button)!.contrast,
      ).toBeGreaterThanOrEqual(4.5);
      const hovered = (await measure()).find((b) => b.text === button)!;
      expect(hovered.background).not.toEqual(action.background);
      await visible.focus();
      await panel.keyboard.press("Tab");
      await panel.keyboard.press("Shift+Tab");
      await expect(visible).toBeFocused();
      await expect
        .poll(() => visible.evaluate((b) => getComputedStyle(b).boxShadow))
        .not.toBe("none");
      await visible.evaluate((b: HTMLButtonElement) => {
        b.disabled = true;
      });
      await expect
        .poll(
          async () => (await measure()).find((b) => b.text === button)!.opacity,
        )
        .toBe(0.5);
      await visible.evaluate((b: HTMLButtonElement) => {
        b.disabled = false;
        b.blur();
      });
      await expect
        .poll(
          async () => (await measure()).find((b) => b.text === button)!.opacity,
        )
        .toBe(1);
      await panel.screenshot({
        path: `test-results/settings-${colorScheme}-${tab.toLowerCase()}.png`,
      });
    }
    await panel.getByRole("button", { name: "Back to chat" }).click();
    await panel
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Button color check");
    const primary = await panel
      .getByRole("button", { name: "Send", exact: true })
      .evaluate((b) => ({
        color: getComputedStyle(b).color,
        primary: getComputedStyle(document.documentElement)
          .getPropertyValue("--primary-foreground")
          .trim(),
        classes: b.className,
      }));
    const primaryColor = await panel.evaluate((color) => {
      const element = document.createElement("span");
      element.style.color = color;
      document.body.append(element);
      const result = getComputedStyle(element).color;
      element.remove();
      return result;
    }, primary.primary);
    expect(primary.color).toBe(primaryColor);
    expect(primary.classes).toContain("bg-primary");
    expect(primary.classes).toContain("text-primary-foreground");
    await panel.getByRole("textbox", { name: "Message", exact: true }).fill("");
  }
  await panel.emulateMedia({ colorScheme: "light" });
});

test("DeepSeek settings persist and native search/fetch show safe sources with any chat model", async () => {
  await clear();
  const chatModel = await sw.evaluate(async () => {
    const { settings } = await (globalThis as any).chrome.storage.local.get(
      "settings",
    );
    return settings.providers[settings.provider].model;
  });
  const calls: { url: string; body: any; auth: string | undefined }[] = [];
  await context.route("https://api.deepseek.com/v1/tools/*", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
        },
      });
      return;
    }
    calls.push({
      url: request.url(),
      body: request.postDataJSON(),
      auth: request.headers().authorization,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(
        request.url().endsWith("/search")
          ? {
              results: [
                {
                  title: "DeepSeek Search documentation",
                  url: "https://api-docs.deepseek.com/guides/search",
                  snippet: "Public search documentation",
                  summary: "Verified summary",
                  date: null,
                  site_name: "DeepSeek",
                },
              ],
            }
          : {
              title: "DeepSeek Search documentation",
              content: "# Verified public documentation",
            },
      ),
    });
  });
  try {
    await panel.getByRole("button", { name: "Settings", exact: true }).click();
    await panel.getByRole("tab", { name: "Tools", exact: true }).click();
    const toggle = panel.getByRole("switch", { name: "Use web search" });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await panel
      .getByLabel("DeepSeek search API key", { exact: true })
      .fill("test-search-only-key");
    await panel
      .getByRole("button", { name: "Test search", exact: true })
      .click();
    await expect(
      panel.getByText("Connected · 1 results", { exact: true }),
    ).toBeVisible();
    expect(calls[0].body).toEqual({
      query: "DeepSeek",
      count: 1,
      need_content: false,
    });
    await panel.reload();
    await panel.getByRole("button", { name: "Settings", exact: true }).click();
    await panel.getByRole("tab", { name: "Tools", exact: true }).click();
    await expect(
      panel.getByRole("switch", { name: "Use web search" }),
    ).toBeChecked();
    await expect(
      panel.getByLabel("DeepSeek search API key", { exact: true }),
    ).toHaveValue("test-search-only-key");
    await panel.getByRole("button", { name: "Back to chat" }).click();
    await site.bringToFront();
    await send("DeepSeek public web lookup");
    await expect(
      panel.getByText("Verified DeepSeek docs.", { exact: true }),
    ).toBeVisible();
    const sources = panel.locator(".web-tool-card").first();
    await expect(sources).toContainText("1 sources");
    await sources.locator("summary").click();
    await expect(
      sources.getByRole("link", { name: "DeepSeek Search documentation" }),
    ).toHaveAttribute("href", "https://api-docs.deepseek.com/guides/search");
    await expect(sources).toContainText("Public search documentation");
    expect(calls.map((c) => c.url.split("/").at(-1))).toEqual([
      "search",
      "search",
      "fetch",
    ]);
    expect(calls.every((c) => c.auth === "Bearer test-search-only-key")).toBe(
      true,
    );
    expect(JSON.stringify(requests.at(-1))).not.toContain(
      "test-search-only-key",
    );
    expect(requests.at(-1).model).toBe(chatModel);
    await panel.reload();
    await expect(panel.locator(".web-tool-card").first()).toContainText(
      "1 sources",
    );
    await panel.getByRole("button", { name: "Settings", exact: true }).click();
    await panel.getByRole("tab", { name: "Tools", exact: true }).click();
    await panel.getByRole("switch", { name: "Use web search" }).click();
    await panel.getByRole("button", { name: "Back to chat" }).click();
  } finally {
    await context.unroute("https://api.deepseek.com/v1/tools/*");
  }
});

test("Danger mode persists, bypasses native approvals and restores safe mode without bypassing MCP", async () => {
  await clear();
  await sw.evaluate(async () => {
    const storage = (globalThis as any).chrome.storage.local;
    const { settings, memory } = await storage.get(["settings", "memory"]);
    await storage.set({
      settings: {
        ...settings,
        dangerMode: false,
        embedding: { ...settings.embedding, enabled: false },
        mcpServers: [
          {
            id: "notes",
            name: "Notes",
            url: settings.mcpServers?.find((s: any) => s.url.includes("/mcp"))
              ?.url,
            token: "",
            enabled: true,
          },
        ],
      },
      memory: { ...memory, enabled: true, memories: [] },
    });
  });
  // Set deterministic MCP endpoint independent of preceding test configuration.
  await sw.evaluate(async (url) => {
    const storage = (globalThis as any).chrome.storage.local;
    const { settings } = await storage.get("settings");
    settings.mcpServers[0].url = url;
    await storage.set({ settings });
  }, base + "/mcp");
  await panel.reload();
  await site.goto(base);
  await site.bringToFront();
  const toggle = async (enabled: boolean) => {
    await panel.getByRole("button", { name: "Settings", exact: true }).click();
    await panel.getByRole("tab", { name: "Tools", exact: true }).click();
    const mode = panel.getByRole("switch", {
      name: "Danger mode",
      exact: true,
    });
    if (enabled) {
      await mode.check();
    } else {
      await mode.uncheck();
    }
    await panel.getByRole("button", { name: "Back to chat" }).click();
  };
  await toggle(true);
  await panel.reload();
  await expect(
    panel.getByRole("status").filter({ hasText: "Danger mode ON" }),
  ).toBeVisible();
  await send("remember: My password is example-test-only");
  await expect(
    panel.getByText("Remembered: My password is example-test-only", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("group", { name: "Approval required" }),
  ).toHaveCount(0);
  expect(requests.filter((r) => r.stream).at(-1).messages[0].content).toContain(
    "Danger mode is ON",
  );
  await send("Danger forget password");
  await expect(
    panel.getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  expect(
    await sw.evaluate(
      async () =>
        (await (globalThis as any).chrome.storage.local.get("memory")).memory
          .memories,
    ),
  ).toHaveLength(0);
  await send("fill name");
  await expect(site.locator("#name")).toHaveValue("Ada");
  await send("submit order");
  await expect(site.locator("#result")).toHaveText("Submitted Ada");
  const other = await context.newPage();
  try {
    await other.goto(base + "/other");
    const tabId = await sw.evaluate(
      async () =>
        (await (globalThis as any).chrome.tabs.query({})).find((t: any) =>
          t.url.endsWith("/other"),
        ).id,
    );
    await site.bringToFront();
    await send("Danger read tab " + tabId);
    await expect(
      panel.getByRole("button", { name: "Send", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("group", { name: "Approval required" }),
    ).toHaveCount(0);
    const answer = requests.filter((r) => r.stream).at(-1);
    expect(
      JSON.stringify(answer.messages.filter((m: any) => m.role === "tool")),
    ).toContain("ALPHA-42");
    await send("write MCP");
    await expect(
      panel.getByRole("group", { name: "Approval required" }),
    ).toContainText("write_note");
    await panel.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "Send", exact: true }),
    ).toBeVisible();
    await toggle(false);
    await expect(
      panel.getByRole("status").filter({ hasText: "Danger mode ON" }),
    ).toHaveCount(0);
    await send("Danger read tab " + tabId);
    await expect(
      panel.getByRole("group", { name: "Approval required" }),
    ).toContainText("Read the tab");
    await panel.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "Send", exact: true }),
    ).toBeVisible();
    await send("submit order");
    await expect(
      panel.getByRole("group", { name: "Approval required" }),
    ).toContainText("Send order");
    await panel.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "Send", exact: true }),
    ).toBeVisible();
    await send("remember: My password is example-test-only");
    await expect(
      panel.getByRole("group", { name: "Approval required" }),
    ).toContainText("sensitive information");
    await panel
      .getByRole("button", { name: "Don't save", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Send", exact: true }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});

test("settings tools deny, connect, update and switch the model without echoing secrets", async () => {
  recapMcp = true;
  try {
    await clear();
    await sw.evaluate(async () => {
      const c = (globalThis as any).chrome;
      const { settings } = await c.storage.local.get("settings");
      settings.provider = "openai-compatible";
      settings.providers["openai-compatible"].model = "test-model";
      settings.providers["openai-compatible"].models = [
        "test-model",
        "test-other",
      ];
      settings.mcpServers = [];
      await c.storage.local.set({ settings });
    });
    await panel.reload();
    await site.bringToFront();
    const servers = () =>
      sw.evaluate(
        async () =>
          (await (globalThis as any).chrome.storage.local.get("settings"))
            .settings.mcpServers ?? [],
      );

    await send("配置 Recap");
    const deny = panel.getByRole("group", { name: "Settings approval" });
    await expect(deny).toContainText(`Add MCP server “Recap” ${base}/mcp`);
    await expect(deny).toContainText("This changes AMA's settings");
    await expect(deny).not.toContainText("recap-secret-token");
    await deny.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(
      panel.getByText(
        `Skipped: Add MCP server “Recap” ${base}/mcp with a token`,
        { exact: true },
      ),
    ).toBeVisible();
    expect(await servers()).toEqual([]);

    await send("配置 Recap");
    const allow = panel.getByRole("group", { name: "Settings approval" });
    await expect(allow).not.toContainText("recap-secret-token");
    await allow.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(
      panel.getByText("Connected MCP server Recap · 2 tools", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await servers())[0]).toMatchObject({
      name: "Recap",
      token: "recap-secret-token",
      enabled: true,
    });
    const toolResults = JSON.stringify(
      requests.flatMap(
        (r) => r.messages?.filter((m: any) => m.role === "tool") ?? [],
      ),
    );
    expect(toolResults).not.toContain("recap-secret-token");

    await send("hello with recap");
    await expect(
      panel.getByRole("button", { name: "Send", exact: true }),
    ).toBeVisible();
    const last = requests.filter((r) => r.stream).at(-1);
    expect(last.tools.map((t: any) => t.function.name)).toEqual(
      expect.arrayContaining(["recap_list_recaps", "recap_get_recap"]),
    );

    await send("关掉 Recap");
    const off = panel.getByRole("group", { name: "Settings approval" });
    await expect(off).toContainText("Change MCP server “Recap”: switch off");
    await off.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(
      panel.getByText("Updated MCP server Recap", { exact: true }),
    ).toBeVisible();
    expect((await servers())[0].enabled).toBe(false);

    await send("切换到 test-other");
    const modelCard = panel.getByRole("group", { name: "Settings approval" });
    await expect(modelCard).toContainText(
      "Switch the chat model to test-other",
    );
    await modelCard.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(
      panel.getByText("Switched to test-other", { exact: true }),
    ).toBeVisible();
    expect(
      await sw.evaluate(async () => {
        const { settings } = await (globalThis as any).chrome.storage.local.get(
          "settings",
        );
        return settings.providers[settings.provider].model;
      }),
    ).toBe("test-other");

    await panel.getByRole("button", { name: "Settings", exact: true }).click();
    await panel.getByRole("tab", { name: "Tools", exact: true }).click();
    await expect(
      panel.getByRole("group", { name: "MCP server Recap" }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Back to chat" }).click();
  } finally {
    recapMcp = false;
  }
});

test("context meter merges split usage, breaks the prompt down and warns when full", async () => {
  await clear();
  await sw.evaluate(async () => {
    const c = (globalThis as any).chrome;
    const { settings } = await c.storage.local.get("settings");
    settings.provider = "openai-compatible";
    settings.providers["openai-compatible"].model = "test-model";
    settings.providers["openai-compatible"].modelInfo = undefined;
    settings.embedding = { ...(settings.embedding ?? {}), enabled: false };
    settings.mcpServers = [];
    const now = Date.now();
    await c.storage.local.set({
      settings,
      memory: {
        schemaVersion: 1,
        enabled: true,
        memories: [
          {
            id: "pref",
            text: "Use concise answers",
            kind: "explicit",
            category: "preference",
            scope: "global",
            evidence: 1,
            confidence: 1,
            lastSeen: now,
            createdAt: now,
          },
        ],
      },
    });
  });
  await panel.reload();
  await site.bringToFront();
  await send("Measure context window");
  await expect(
    panel.getByText("Context answer", { exact: true }),
  ).toBeVisible();
  const unlimited = panel.getByRole("status", {
    name: "Context window: 1.3k tokens",
  });
  await expect(unlimited).toBeVisible();
  await expect(panel.getByText("Used 1 memories")).toBeVisible();
  expect(requests.filter((r) => r.stream).at(-1).stream_options).toEqual({
    include_usage: true,
  });
  // Without /models data the popup still shows the ring, breakdown and hint.
  await unlimited.hover();
  const unlimitedPopup = panel.locator(".context-popup");
  await expect(unlimitedPopup).toBeVisible();
  await expect(unlimitedPopup).toContainText("1,250 tokens");
  await expect(unlimitedPopup).toContainText("System prompt");
  await expect(unlimitedPopup).toContainText(
    "Fetch models in Settings to see the limit.",
  );
  await expect(unlimitedPopup.locator("svg[data-segments]")).toHaveAttribute(
    "data-segments",
    /^[5-7]$/,
  );
  await panel.mouse.move(0, 0);

  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("button", { name: "Fetch", exact: true }).click();
  await expect(panel.getByText(/2 models/)).toBeVisible();
  await expect(
    panel.getByText(/Model info: context 100k · output 128k · pricing/),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Back to chat" }).click();
  const limited = panel.getByRole("status", {
    name: "Context window: 1.3k / 100k",
  });
  await expect(limited).toBeVisible();
  await limited.hover();
  const popup = panel.locator(".context-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("1,250 of 100,000 tokens");
  await expect(popup).toContainText(/Cost of this reply: \$0\.001[45]/);
  const breakdown = popup.getByRole("list", { name: "Context breakdown" });
  for (const label of [
    "System prompt",
    "Tool definitions",
    "Page content",
    "Memory",
    "Reply",
  ])
    await expect(breakdown).toContainText(label);
  expect(await breakdown.locator("li").count()).toBeGreaterThanOrEqual(5);
  await expect(popup.locator("svg[data-segments]")).toHaveAttribute(
    "data-segments",
    /^[5-7]$/,
  );

  await send("Fill context window");
  await expect(panel.getByText("Full answer", { exact: true })).toBeVisible();
  const full = panel.getByRole("status", {
    name: "Context window: 97k / 100k",
  });
  await expect(full).toBeVisible();
  await expect(full).toHaveClass(/text-destructive/);
  await full.hover();
  await expect(panel.locator(".context-popup")).toContainText(
    "Getting full: clear the chat",
  );
  await panel.reload();
  await expect(
    panel.getByRole("status", { name: "Context window: 97k / 100k" }),
  ).toBeVisible();
});

test("learning re-learns an old state, shows noticed rows and accepts a suggestion", async () => {
  learning = true;
  try {
    await clear();
    await sw.evaluate(async () => {
      const c = (globalThis as any).chrome;
      const { settings } = await c.storage.local.get("settings");
      settings.embedding = { ...(settings.embedding ?? {}), enabled: false };
      settings.provider = "openai-compatible";
      settings.providers["openai-compatible"].model = "test-model";
      settings.mcpServers = [];
      const now = Date.now();
      await c.storage.local.set({
        settings,
        memory: { schemaVersion: 1, enabled: true, memories: [] },
        memoryLearning: {
          cursors: { s1: 4 },
          eventCursor: 0,
          runs: 24,
          lastRunAt: 0,
        },
        activeSessionId: "s1",
        sessions: [
          { id: "s1", title: "Brief", createdAt: now, updatedAt: now },
        ],
        "session:s1": [
          {
            id: "u1",
            role: "user",
            metadata: { domain: "example.com" },
            parts: [{ type: "text", text: "Keep answers brief" }],
          },
        ],
      });
    });
    await panel.reload();
    await expect
      .poll(() =>
        sw.evaluate(
          async () =>
            (await (globalThis as any).chrome.storage.local.get("memory"))
              .memory.memories.length,
        ),
      )
      .toBe(1);
    const extraction = requests
      .filter((r) =>
        r.messages?.[0]?.content?.includes("maintain a short list"),
      )
      .at(-1);
    expect(extraction.tools[0].function.name).toBe("answer");
    expect(
      extraction.tools[0].function.parameters.properties.ops,
    ).toBeDefined();
    expect(extraction.response_format).toBeUndefined();
    expect(extraction.tool_choice).toMatchObject({
      type: "function",
      function: { name: "answer" },
    });
    expect(
      (
        await sw.evaluate(
          async () =>
            (
              await (globalThis as any).chrome.storage.local.get(
                "memoryLearning",
              )
            ).memoryLearning,
        )
      ).runs,
    ).toBe(25);

    await panel.getByRole("button", { name: "Settings", exact: true }).click();
    await panel.getByRole("tab", { name: "Memory", exact: true }).click();
    await panel
      .getByRole("button", { name: "Manage memories", exact: true })
      .click();
    const noticed = panel.getByRole("region", { name: "Noticed so far" });
    await expect(noticed).toContainText("last ran");
    await expect(noticed).toContainText("Prefers short answers · seen 1 of 2");
    await noticed
      .getByRole("button", { name: "Remember", exact: true })
      .click();
    await expect
      .poll(() =>
        sw.evaluate(
          async () =>
            (await (globalThis as any).chrome.storage.local.get("memory"))
              .memory.memories[0],
        ),
      )
      .toMatchObject({ kind: "explicit", status: "active" });
    await panel.getByRole("button", { name: "Back", exact: true }).click();
    await panel.getByRole("button", { name: "Back to chat" }).click();
    await send("记住 用中文回答");
    await expect(
      panel.getByText("Remembered: 用中文回答", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("group", { name: "Approval required" }),
    ).toHaveCount(0);
  } finally {
    learning = false;
  }
});

test("run_js chains large results by data ID without copying datasets through the model", async () => {
  await clear();
  await site.bringToFront();
  await send(dataPipelineQuery);
  await expect(
    panel.getByText("Data pipeline complete: 12000 rows", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    panel.getByText(dataPipelineTail, { exact: false }),
  ).toBeVisible();
  const pipeline = requests.filter((r) =>
    JSON.stringify(r.messages).includes(dataPipelineQuery),
  );
  const calls = pipeline.flatMap((r: any) =>
    r.messages
      .filter((m: any) => m.role === "assistant")
      .flatMap((m: any) => m.tool_calls ?? [])
      .filter((c: any) => c.function.name === "run_js")
      .map((c: any) => ({ ...c, args: JSON.parse(c.function.arguments) })),
  );
  const reference = calls.find((c: any) => c.args.data);
  expect(reference.args.data.rows).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(reference.args)).not.toContain(dataPipelineTail);
  expect(reference.function.arguments.length).toBeLessThan(4000);
  // The prompt that introduces the reference carries the ID and a bounded
  // preview only; the original 12k rows never re-enter the model context.
  const requestUsingReference = pipeline.find((r: any) =>
    r.messages.some((m: any) =>
      (m.tool_calls ?? []).some(
        (c: any) =>
          c.function.name === "run_js" && JSON.parse(c.function.arguments).data,
      ),
    ),
  );
  const introduced = requestUsingReference.messages.findIndex((m: any) =>
    (m.tool_calls ?? []).some(
      (c: any) =>
        c.function.name === "run_js" && JSON.parse(c.function.arguments).data,
    ),
  );
  const sent = JSON.stringify(
    requestUsingReference.messages.slice(0, introduced + 1),
  );
  expect(sent).toContain(reference.args.data.rows);
  expect(sent).not.toContain(dataPipelineTail);
  expect(sent).not.toContain('"row-11999"');
  expect(sent.length).toBeLessThan(200000);
});

test("text size setting scales both user and assistant message text", async () => {
  await clear();
  const setScale = async (scale: number) => {
    await sw.evaluate(async (value) => {
      const c = (globalThis as any).chrome;
      const { settings } = await c.storage.local.get("settings");
      settings.fontScale = value;
      await c.storage.local.set({ settings });
    }, scale);
    await panel.reload();
    await site.bringToFront();
  };
  const sizes = () =>
    panel.evaluate(() => ({
      user: parseFloat(
        getComputedStyle(document.querySelector(".user-bubble")!).fontSize,
      ),
      assistant: parseFloat(
        getComputedStyle(document.querySelector(".prose")!).fontSize,
      ),
    }));
  try {
    await setScale(1);
    await send("What is the lookup code?");
    await expect(panel.locator(".user-bubble")).toBeVisible();
    await expect(panel.locator(".prose").first()).toBeVisible();
    const base = await sizes();
    await setScale(1.3);
    const large = await sizes();
    expect(large.user / base.user).toBeCloseTo(1.3, 2);
    expect(large.assistant / base.assistant).toBeCloseTo(1.3, 2);
  } finally {
    await setScale(1);
  }
});

test("capture context meter screenshots", async () => {
  mkdirSync("docs/screenshots", { recursive: true });
  await clear();
  await sw.evaluate(async () => {
    const c = (globalThis as any).chrome;
    const { settings } = await c.storage.local.get("settings");
    settings.provider = "openai-compatible";
    settings.providers["openai-compatible"].model = "claude-haiku-5-5";
    settings.providers["openai-compatible"].modelInfo = undefined;
    settings.embedding = { ...(settings.embedding ?? {}), enabled: false };
    settings.mcpServers = [];
    const now = Date.now();
    await c.storage.local.set({
      settings,
      memory: {
        schemaVersion: 1,
        enabled: true,
        memories: [
          {
            id: "pref",
            text: "Use concise answers",
            kind: "explicit",
            category: "preference",
            scope: "global",
            evidence: 1,
            confidence: 1,
            lastSeen: now,
            createdAt: now,
          },
        ],
      },
    });
  });
  await panel.reload();
  await site.bringToFront();
  await send("Measure context window");
  await expect(
    panel.getByText("Context answer", { exact: true }),
  ).toBeVisible();
  const catalog = panel.getByRole("status", {
    name: "Context window: 1.3k / 1M",
  });
  await catalog.hover();
  await expect(panel.locator(".context-popup")).toBeVisible();
  await expect(panel.locator(".context-popup")).toContainText(
    "Limit from the models.dev catalog",
  );
  await panel.locator(".context-popup").screenshot({
    path: "docs/screenshots/context-popup-catalog-limit.png",
  });
  await panel.mouse.move(0, 0);

  await panel.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByRole("button", { name: "Fetch", exact: true }).click();
  await expect(
    panel.getByText(/Model info: context 1M · output 128k/),
  ).toBeVisible();
  await expect(panel.getByText(/Context from models.dev/)).toBeVisible();
  await panel.screenshot({
    path: "docs/screenshots/settings-model-info.png",
    fullPage: false,
  });
  await panel.getByRole("button", { name: "Back to chat" }).click();
  const limited = panel.getByRole("status", {
    name: "Context window: 1.3k / 1M",
  });
  await expect(limited).toBeVisible();
  await limited.hover();
  await expect(panel.locator(".context-popup")).toBeVisible();
  await panel.screenshot({
    path: "docs/screenshots/context-meter-panel.png",
    fullPage: false,
  });
  await panel.locator(".context-popup").screenshot({
    path: "docs/screenshots/context-popup-limited.png",
  });
});
