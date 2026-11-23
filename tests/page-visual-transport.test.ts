import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { readUIMessageStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createModel } from "@/lib/model";
import { browser } from "wxt/browser";
import { LocalChatTransport } from "@/lib/local-chat-transport";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type ProviderId,
} from "@/lib/settings";
import { buildInstructions } from "@/lib/prompt";
import { createAnnotationTools } from "@/lib/annotation-tool";
import { applyAnnotations } from "@/lib/annotation-layer";
import { captureTokens } from "@/lib/live-capture";
import {
  createPageVisualTools,
  CaptureAttempts,
} from "@/lib/page-visual-tools";
import { saveSession, loadSession } from "@/lib/sessions";

vi.mock("wxt/browser", () => {
  const event = { addListener: vi.fn(), removeListener: vi.fn() };
  return {
    browser: {
      tabs: {
        get: vi.fn(),
        onActivated: event,
        onUpdated: event,
        onRemoved: event,
        onDetached: event,
        onReplaced: event,
      },
      windows: { get: vi.fn(), onFocusChanged: event },
      scripting: { executeScript: vi.fn() },
    },
  };
});
const target = {
  tabId: 3,
  windowId: 4,
  documentId: "original",
  url: "https://example.test/",
};
const page = {
  captureTarget: target,
  tabId: 3,
  url: target.url,
  title: "Page",
  markdown: "Page text ".repeat(320),
  elements: [],
  selection: "",
  truncated: false,
};
function validTarget() {
  vi.mocked(browser.tabs.get).mockResolvedValue({
    ...target,
    active: true,
    incognito: false,
  } as any);
  vi.mocked(browser.windows.get).mockResolvedValue({ focused: true } as any);
  (browser.scripting.executeScript as any).mockResolvedValue([
    { documentId: target.documentId, frameId: 0, result: target.url },
  ]);
}
const image = {
  bytes: new Uint8Array([255, 216, 255, 217]),
  width: 1280,
  height: 8000,
  coverage: { start: 0, end: 12000, total: 30000, partial: true },
};
const bytes64 = "/9j/2Q==";
const settings = (provider: ProviderId = "openai-compatible"): Settings => ({
  ...DEFAULT_SETTINGS,
  provider,
  providers: {
    ...DEFAULT_SETTINGS.providers,
    [provider]: {
      baseURL: "https://mock.test",
      apiKey: "mock",
      model: DEFAULT_SETTINGS.providers[provider].model,
    },
  },
});
const user = (
  id = "u",
  text = "Does the footer overlap the chart legend?",
): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const call = (toolName: string, toolCallId = "shot", input = "{}") => ({
  type: "tool-call",
  toolCallId,
  toolName,
  input,
});
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const text = [
  { type: "text-start", id: "text" },
  { type: "text-delta", id: "text", delta: "Done" },
  { type: "text-end", id: "text" },
];
const parts = (body: unknown) => JSON.stringify(body);
const assertNoPixels = (body: unknown) => {
  expect(parts(body)).not.toMatch(/image\/jpeg|\/9j\/2Q==|"0":255,"1":216/);
};
async function send(
  transport: LocalChatTransport,
  messages: UIMessage[],
  options: { signal?: AbortSignal; regenerate?: boolean; chatId?: string } = {},
) {
  const stream = await transport.sendMessages({
    chatId: options.chatId ?? "visual",
    messages,
    trigger: options.regenerate ? "regenerate-message" : "submit-message",
    abortSignal: options.signal,
    messageId: undefined,
  });
  const [ui, raw] = stream.tee();
  const chunks: any[] = [];
  const consume = (async () => {
    for await (const chunk of raw) chunks.push(chunk);
  })();
  let response: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    stream: ui,
    message:
      messages.at(-1)?.role === "assistant" ? messages.at(-1) : undefined,
    onError: () => {},
  }))
    response = message;
  await consume;
  return { response: response!, chunks };
}
function mockStream(outputs: (any[] | Error)[]) {
  let step = 0;
  const prompts: any[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (request) => {
      prompts.push(structuredClone(request.prompt));
      const output = outputs[step++] ?? text;
      if (output instanceof Error) throw output;
      const toolCall = output.some((p) => p.type === "tool-call");
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of [
              { type: "stream-start", warnings: [] },
              ...output,
              {
                type: "finish",
                finishReason: {
                  unified: toolCall ? "tool-calls" : "stop",
                  raw: "stop",
                },
                usage,
              },
            ])
              controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  });
  return Object.assign(model, { prompts });
}
function harness(outputs: (any[] | Error)[], config: Settings = settings()) {
  validTarget();
  const model = mockStream(outputs);
  const capture = vi.fn(async () => image);
  const summarize = vi.fn(async () => ({
    text: "summary",
    inputTokens: 0,
    outputTokens: 0,
  }));
  let liveSettings = config,
    clock = 50;
  const transport = new LocalChatTransport({
    loadSettings: async () => liveSettings,
    saveSettings: async (next) => {
      liveSettings = next;
    },
    createModel: async () => model,
    readActivePage: async () => page,
    readTabPage: async () => page,
    now: () => clock,
    captureImage: capture,
    summarize,
  });
  return {
    model,
    capture,
    transport,
    summarize,
    moveTime: (ms: number) => (clock += ms),
    setSettings: (s: Settings) => {
      liveSettings = s;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

it("binds drawing to the eligible starting document and respects abort", async () => {
  validTarget();
  const args = { toolCallId: "draw", messages: [], context: {} };
  const input = { operation: { action: "clear" as const } };
  const exec = createAnnotationTools({ target }).annotate_page.execute!;
  expect(
    await createAnnotationTools({}).annotate_page.execute!(input, args),
  ).toMatchObject({ ok: false });
  vi.mocked(browser.tabs.get).mockResolvedValueOnce({ active: false } as any);
  expect(await exec(input, args)).toMatchObject({ ok: false });
  (browser.scripting.executeScript as any).mockResolvedValueOnce([
    { documentId: "replacement", frameId: 0, result: target.url },
  ]);
  expect(await exec(input, args)).toMatchObject({ ok: false });
  await expect(
    exec(input, { ...args, abortSignal: AbortSignal.abort() }),
  ).rejects.toThrow();
  expect(
    vi
      .mocked(browser.scripting.executeScript)
      .mock.calls.filter(([o]) => o.func === applyAnnotations),
  ).toHaveLength(0);
});

it("discovers annotation without injection, returns handles, and leaves the capture attempt available", async () => {
  const input = JSON.stringify({
    operation: {
      action: "add",
      shapes: [{ kind: "label", at: { x: 0.5, y: 0.5 }, text: "Peak" }],
    },
  });
  const { transport, capture } = harness([
    [call("annotate_page", "draw", input)],
    [call("capture_viewport")],
    text,
    text,
  ]);
  const scripting = vi.mocked(browser.scripting.executeScript);
  scripting.mockClear();
  (scripting as any).mockImplementation(async ({ func }: any) => [
    {
      documentId: target.documentId,
      frameId: 0,
      result:
        func === applyAnnotations
          ? { ok: true, ids: ["mark-id"], count: 1 }
          : target.url,
    },
  ]);
  expect(
    (await transport.composerTools("visual")).tools.some(
      (t) => t.name === "annotate_page",
    ),
  ).toBe(true);
  expect(scripting).not.toHaveBeenCalled();
  const { response } = await send(transport, [user()]);
  expect(JSON.stringify(response)).toContain("mark-id");
  expect(capture).toHaveBeenCalledTimes(1);
  await send(transport, [user(), response, user("u2", "Thanks")]);
  expect(
    scripting.mock.calls.filter(([o]) => o.func === applyAnnotations),
  ).toHaveLength(1);
});

it("distinguishes drawn guides from indexed highlights and disallows guessing price coordinates", () => {
  const instructions = buildInstructions(page);
  expect(instructions).toContain("annotate_page rather than highlight");
  expect(instructions).toContain("do not guess where a price is");
  expect(instructions).toContain("清除批注");
});

it.each(["openai-compatible", "openai", "anthropic", "google"] as const)(
  "encodes real model image input and a paired tool result for %s",
  async (provider) => {
    validTarget();
    const config = settings(provider);
    const model: any = await createModel(config);
    const first = mockStream([[call("capture_full_page")]]);
    const request = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        Response.json(
          {
            error: {
              message: "This endpoint does not support image input",
              status: "INVALID_ARGUMENT",
              type: "invalid_request_error",
            },
          },
          { status: 400 },
        ),
    );
    vi.stubGlobal("fetch", request);
    const capture = vi.fn(async () => image);
    const transport = new LocalChatTransport({
      loadSettings: async () => config,
      readActivePage: async () => page,
      captureImage: capture,
      createModel: async () => ({
        specificationVersion: model.specificationVersion,
        modelId: model.modelId,
        provider: model.provider,
        supportedUrls: model.supportedUrls,
        doGenerate: model.doGenerate.bind(model),
        doStream: (params: any) =>
          first.doStreamCalls.length
            ? model.doStream(params)
            : first.doStream(params),
      }),
    });
    await send(transport, [user()]);
    expect(capture).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    const dataURL = `data:image/jpeg;base64,${bytes64}`;
    if (provider === "openai-compatible") {
      expect(String(url)).toContain("/chat/completions");
      expect(body.messages.at(-3).tool_calls[0]).toMatchObject({
        id: "shot",
        function: { name: "capture_full_page" },
      });
      expect(body.messages.at(-2)).toMatchObject({
        role: "tool",
        tool_call_id: "shot",
      });
      expect(body.messages.at(-1)).toMatchObject({
        role: "user",
        content: [
          expect.objectContaining({ type: "text" }),
          { type: "image_url", image_url: { url: dataURL } },
        ],
      });
    } else if (provider === "openai") {
      expect(String(url)).toContain("/responses");
      expect(body.input.at(-3)).toMatchObject({
        type: "function_call",
        call_id: "shot",
        name: "capture_full_page",
      });
      expect(body.input.at(-2)).toMatchObject({
        type: "function_call_output",
        call_id: "shot",
      });
      expect(body.input.at(-1)).toMatchObject({
        role: "user",
        content: [
          expect.objectContaining({ type: "input_text" }),
          { type: "input_image", image_url: dataURL },
        ],
      });
    } else if (provider === "anthropic") {
      expect(String(url)).toContain("/messages");
      expect(body.messages.at(-2).content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool_use",
            id: "shot",
            name: "capture_full_page",
          }),
        ]),
      );
      expect(body.messages.at(-1)).toMatchObject({
        role: "user",
        content: [
          expect.objectContaining({ type: "tool_result", tool_use_id: "shot" }),
          expect.objectContaining({ type: "text" }),
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: bytes64 },
          },
        ],
      });
    } else {
      expect(String(url)).toContain(":streamGenerateContent");
      const blocks = body.contents.flatMap((message: any) => message.parts);
      expect(blocks.slice(-4)).toMatchObject([
        { functionCall: { name: "capture_full_page" } },
        { functionResponse: { name: "capture_full_page" } },
        { text: expect.stringContaining("AMA visual evidence") },
        { inlineData: { mimeType: "image/jpeg", data: bytes64 } },
      ]);
    }
    expect(parts(body).split(bytes64).length - 1).toBe(1);
  },
);

it("documents intent rather than screenshot commands or text sufficiency", () => {
  expect(buildInstructions(page)).toContain(
    "Choose by intent, not trigger phrases",
  );
  expect(buildInstructions(page)).toContain(
    "Either tool can be your first call, even on a text-rich page",
  );
  expect(buildInstructions(page)).toContain(
    "when an attachment already provides the needed evidence",
  );
});

it("has strict empty schemas and denies overrides even with a valid starting target", async () => {
  const capture = vi.fn();
  const claim = new CaptureAttempts();
  const args = { toolCallId: "shot", messages: [], context: {} };
  const tools = createPageVisualTools({
    target,
    capture,
    claim: () => claim.claim("chat", "u", [user()]),
    receive: () => true,
  });
  expect(
    (
      (await tools.capture_full_page.execute!(
        { tab: 50 } as never,
        args,
      )) as any
    ).error,
  ).toContain("no arguments");
  expect(
    ((await tools.capture_viewport.execute!({}, args)) as any).error,
  ).toContain("single screenshot attempt");
  expect(capture).not.toHaveBeenCalled();
  expect(createPageVisualTools().capture_full_page.execute).toBeUndefined();
});

it("pairs a real model image once, keeps the complete tool group, and persists just a receipt", async () => {
  const { capture, transport, model, summarize } = harness(
    [
      [call("capture_full_page"), call("capture_viewport", "extra")],
      [call("read_chat_history", "history", '{"limit":2}')],
      text,
      [call("capture_viewport", "retry")],
      text,
      text,
    ],
    { ...settings(), dangerMode: true },
  );
  const start = [user()];
  const { response, chunks } = await send(transport, start);
  expect(capture).toHaveBeenCalledOnce();
  expect(capture).toHaveBeenCalledWith("capture_full_page", target, undefined);
  expect(chunks).not.toContainEqual(
    expect.objectContaining({ type: "tool-approval-request" }),
  );
  expect(parts(chunks)).toContain("Partial: 0–12000 of 30000 CSS px");
  expect(parts(chunks)).toContain("single screenshot attempt");
  expect(parts(chunks)).toContain("Image accepted");
  const { prompts } = model;
  expect(prompts).toHaveLength(3);
  assertNoPixels(prompts[0]);
  expect(prompts[1].at(-2)).toMatchObject({
    role: "tool",
    content: [
      expect.objectContaining({ toolCallId: "shot" }),
      expect.objectContaining({ toolCallId: "extra" }),
    ],
  });
  expect(prompts[1].at(-1)).toMatchObject({
    role: "user",
    content: [
      { type: "text", text: expect.stringContaining("Partial: 0–12000") },
      {
        type: "file",
        data: { type: "data", data: image.bytes },
        mediaType: "image/jpeg",
      },
    ],
  });
  assertNoPixels(prompts[2]);
  assertNoPixels(chunks);
  assertNoPixels(response);
  assertNoPixels(summarize.mock.calls);
  await saveSession("visual", [...start, response]);
  assertNoPixels(await loadSession("visual"));
  await send(transport, start, { regenerate: true });
  expect(capture).toHaveBeenCalledOnce();
  await send(transport, [
    ...(await loadSession("visual")),
    user("other", "Summarize the headings"),
  ]);
  model.prompts.slice(2).forEach(assertNoPixels);
});

it("keeps text-only requests valid when the image exceeds the safe budget", async () => {
  expect(captureTokens(image)).toBeGreaterThan(
    captureTokens({ ...image, width: 1600, height: 900 }),
  );
  const { transport, model } = harness([[call("capture_full_page")], text], {
    ...settings(),
    compaction: { enabled: false, contextTokens: 16000 },
  });
  const result = await send(transport, [user()]);
  expect(model.doStreamCalls).toHaveLength(2);
  expect(parts(result.chunks)).toContain("did not fit the safe context budget");
  expect(parts(model.doStreamCalls[1].prompt)).toContain(
    "did not fit the safe context budget",
  );
  assertNoPixels(model.doStreamCalls);
});

it("explains vision rejection without changing model or replaying pixels on the next text question", async () => {
  const { transport, model, capture } = harness([
    [call("capture_viewport")],
    new Error("This model does not support image input"),
    text,
  ]);
  const { response, chunks } = await send(transport, [user()]);
  expect(parts(chunks)).toContain("Choose a vision-capable model");
  expect(parts(chunks)).not.toContain("Image accepted");
  await send(transport, [
    user(),
    response,
    user("n", "Just summarize the page text"),
  ]);
  expect(model.doStreamCalls).toHaveLength(3);
  assertNoPixels(model.doStreamCalls[2].prompt);
  expect(capture).toHaveBeenCalledOnce();
});

it.each([
  "match",
  "expired",
  "navigation",
  "model",
  "cleared",
  "aborted",
  "reload",
])(
  "handles an approval continuation with %s capture state",
  async (condition) => {
    // Configuration writes always need approval.
    const paused = harness([
      [
        call("capture_full_page"),
        call("set_memory_enabled", "approve", '{"enabled":false}'),
      ],
      text,
    ]);
    const args = [user()];
    const controller = new AbortController();
    const first = await send(paused.transport, args, {
      signal: controller.signal,
    });
    expect(first.response.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "approve",
          state: "approval-requested",
        }),
      ]),
    );
    expect(paused.capture).toHaveBeenCalledOnce();
    expect(paused.model.doStreamCalls).toHaveLength(1);
    assertNoPixels(first.response);
    if (condition === "expired") paused.moveTime(120001);
    if (condition === "navigation")
      vi.mocked(browser.scripting.executeScript).mockRejectedValueOnce(
        new Error("Document no longer exists"),
      );
    if (condition === "model") paused.setSettings(settings("google"));
    if (condition === "cleared") paused.transport.clearCapture();
    if (condition === "aborted") {
      controller.abort();
      paused.transport.interruptStats("visual", "stopped");
    }
    const response: UIMessage = {
      ...first.response,
      parts: first.response.parts.map((part) =>
        "toolCallId" in part &&
        part.toolCallId === "approve" &&
        part.state === "approval-requested"
          ? {
              ...part,
              state: "approval-responded",
              approval: { id: part.approval.id, approved: false },
            }
          : part,
      ),
    };
    const { transport: continuation, model } = paused;
    const { prompts } = model;
    if (condition === "reload") {
      // A new transport has no live screenshot; it never replays as text or media.
      const fresh = harness([text]);
      await send(fresh.transport, [...args, response]);
      assertNoPixels(fresh.model.doStreamCalls);
      expect(fresh.capture).not.toHaveBeenCalled();
      paused.transport.clearCapture();
      return;
    }
    const next = await send(continuation, [...args, response]);
    const prompt = prompts.at(-1);
    if (condition === "match") {
      expect(prompt?.at(-1)).toMatchObject({
        role: "user",
        content: [
          expect.objectContaining({ type: "text" }),
          expect.objectContaining({ type: "file", mediaType: "image/jpeg" }),
        ],
      });
      expect(prompt?.at(-2)).toMatchObject({
        role: "tool",
        content: expect.arrayContaining([
          expect.objectContaining({ toolCallId: "approve" }),
        ]),
      });
      await send(continuation, [...args, response]);
      assertNoPixels(prompts.at(-1));
    } else {
      assertNoPixels(prompt);
      expect(parts(next.chunks)).toContain("no longer available");
    }
    expect(paused.capture).toHaveBeenCalledOnce();
  },
);
