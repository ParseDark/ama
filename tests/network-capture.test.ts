import { describe, it, expect, vi } from "vitest";
import {
  NetworkCapture,
  type CaptureAdapter,
} from "../src/lib/network/capture";

function setup(overrides: Partial<CaptureAdapter> = {}) {
  const adapter: CaptureAdapter = {
    attach: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
    command: vi.fn(async (_tab, method) =>
      method === "Network.getResponseBody" ? { body: "hello" } : {},
    ),
    resolveTab: vi.fn(async (id) => ({
      id: id ?? 1,
      url: "https://example.com",
    })),
    notify: vi.fn(),
    ...overrides,
  };
  return { adapter, capture: new NetworkCapture(adapter, 10) };
}
function req(c: NetworkCapture, id: string, type = "Fetch") {
  c.event(1, "Network.requestWillBeSent", {
    requestId: id,
    type,
    request: {
      method: "GET",
      url: "https://example.com/" + id,
      headers: { Authorization: "secret" },
    },
  });
}
function response(c: NetworkCapture, id: string) {
  c.event(1, "Network.responseReceived", {
    requestId: id,
    type: "Fetch",
    response: { status: 200, headers: { "Set-Cookie": "secret" } },
  });
  c.event(1, "Network.loadingFinished", { requestId: id });
}
describe("network capture", () => {
  it("attaches, merges events, filters and preserves isolated snapshots", async () => {
    const { capture: c, adapter } = setup();
    await c.start("a");
    req(c, "1");
    req(c, "img", "Image");
    response(c, "1");
    const result = await c.stop("a");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      status: 200,
      responseBody: "hello",
      requestHeaders: { Authorization: "secret" },
      responseHeaders: { "Set-Cookie": "secret" },
    });
    expect(adapter.attach).toHaveBeenCalledOnce();
    expect(adapter.detach).toHaveBeenCalledOnce();
    expect(await c.stop("a")).toEqual(result);
    result.records[0].requestHeaders.Authorization = "changed";
    result.records[0].responseHeaders["Set-Cookie"] = "changed";
    const fresh = await c.stop("a");
    expect(fresh.records[0].requestHeaders.Authorization).toBe("secret");
    expect(fresh.records[0].responseHeaders["Set-Cookie"]).toBe("secret");
  });
  it("cleans up enable failure and serializes simultaneous starts", async () => {
    const { capture: c, adapter } = setup({
      command: vi.fn(async () => {
        throw Error("secret");
      }),
    });
    await expect(c.start("a")).rejects.toThrow("Unable to start");
    expect(adapter.detach).toHaveBeenCalledOnce();
    expect(c.status().state).toBe("stopped");
    const other = setup();
    const [a, b] = await Promise.all([
      other.capture.start("a"),
      other.capture.start("a"),
    ]);
    expect(a.captureId).toBe(b.captureId);
    await expect(other.capture.start("b")).rejects.toThrow();
  });
  it("handles early extra info, failure and detach", async () => {
    const { capture: c } = setup();
    await c.start("a");
    c.event(1, "Network.responseReceivedExtraInfo", {
      requestId: "1",
      headers: { Cookie: "secret" },
    });
    req(c, "1");
    c.event(1, "Network.responseReceived", {
      requestId: "1",
      type: "Fetch",
      response: { status: 401, headers: {} },
    });
    c.event(1, "Network.loadingFailed", {
      requestId: "1",
      errorText: "sensitive",
    });
    c.detached(1, "tab_closed");
    const result = await c.stop("a");
    expect(result.reason).toBe("tab_closed");
    expect(result.records[0]).toMatchObject({
      status: 401,
      responseHeaders: { Cookie: "secret" },
      errorText: "Network request failed",
    });
    await expect(c.stop("b")).rejects.toThrow();
  });
  it("bounds body and first 200 records", async () => {
    const { capture: c } = setup({
      command: vi.fn(async (_t, m) =>
        m === "Network.getResponseBody" ? { body: "😀".repeat(30000) } : {},
      ),
    });
    await c.start("a");
    for (let i = 0; i < 201; i++) req(c, String(i));
    response(c, "0");
    const s = await c.stop("a");
    expect(s.records).toHaveLength(200);
    expect(s.droppedCount).toBe(1);
    expect(s.records[0].responseBodyTruncated).toBe(true);
    expect(new TextEncoder().encode(s.records[0].responseBody!).length).toBe(
      102400,
    );
  });
  it("isolates late body after stop and subsequent capture", async () => {
    let resolve!: (value: unknown) => void;
    const body = new Promise((r) => {
      resolve = r;
    });
    const { capture: c } = setup({
      command: vi.fn(async (_t, m) =>
        m === "Network.getResponseBody" ? body : {},
      ),
    });
    await c.start("a");
    req(c, "1");
    response(c, "1");
    const s = await c.stop("a");
    expect(s.records[0].bodyError).toBeDefined();
    await c.start("a");
    resolve({ body: "late" });
    await Promise.resolve();
    expect((await c.stop("a")).records).toHaveLength(0);
  });
  it("handles binary body and request body retrieval", async () => {
    const { capture: c } = setup({
      command: vi.fn(async (_t, m) =>
        m === "Network.getResponseBody"
          ? { body: btoa("abc"), base64Encoded: true }
          : m === "Network.getRequestPostData"
            ? { postData: "payload" }
            : {},
      ),
    });
    await c.start("a");
    c.event(1, "Network.requestWillBeSent", {
      requestId: "x",
      type: "XHR",
      request: {
        url: "https://example.com",
        method: "POST",
        hasPostData: true,
      },
    });
    response(c, "x");
    const s = await c.stop("a");
    expect(s.records[0]).toMatchObject({
      requestBody: "payload",
      responseBody: "YWJj",
      bodyEncoding: "base64",
    });
  });
});
