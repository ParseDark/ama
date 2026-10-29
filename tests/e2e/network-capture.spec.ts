import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";
import type {
  CaptureSnapshot,
  CaptureStatus,
} from "../../src/lib/network/types";

test("captures real HTTP traffic from a tab and passes records to the sandbox", async () => {
  const large = "L".repeat(110 * 1024);
  const server = createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Set-Cookie": "capture_cookie=cookie-value; Path=/; SameSite=Lax",
      });
      res.end("<!doctype html><title>Network capture site</title>");
    } else if (req.url === "/post") {
      res.writeHead(201, {
        "Content-Type": "application/json",
        "X-Capture-Response": "response-value",
      });
      res.end('{"result":"created"}');
    } else if (req.url === "/missing") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("missing resource");
    } else if (req.url === "/large") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(large);
    } else if (req.url === "/style.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end("body { color: red }");
    } else if (req.url === "/image.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  const base = `http://127.0.0.1:${address.port}`;
  const extension = resolve(".output/chrome-mv3");
  let context:
    Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    context = await chromium.launchPersistentContext("", {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : { channel: "chromium" }),
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    const sw =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const site = await context.newPage();
    await site.goto(base + "/");
    const panel = await context.newPage();
    await panel.goto(
      `chrome-extension://${new URL(sw.url()).host}/sidepanel.html`,
    );
    const tabId = await panel.evaluate(async (url) => {
      const tabs = await (globalThis as any).chrome.tabs.query({});
      const tab = tabs.find(
        (item: { url?: string; id?: number }) => item.url === url,
      );
      if (tab?.id === undefined) throw new Error("Site tab not found");
      return tab.id;
    }, base + "/");
    const request = (action: string, sessionId = "network-e2e", id?: number) =>
      panel.evaluate(
        async ({ action, sessionId, tabId }) =>
          (globalThis as any).chrome.runtime.sendMessage({
            type: "network-capture",
            action,
            sessionId,
            tabId,
          }),
        { action, sessionId, tabId: id },
      );
    const start = await request("start", "network-e2e", tabId);
    expect(start).toMatchObject({
      ok: true,
      value: { state: "capturing", tabId, count: 0 },
    });
    await site.evaluate(async () => {
      await fetch("/post", {
        method: "POST",
        headers: {
          Authorization: "Bearer e2e-secret",
          "Content-Type": "application/json",
          "X-Capture-Request": "request-value",
        },
        body: '{"hello":"world"}',
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/missing");
        xhr.onload = () => resolve();
        xhr.onerror = () => reject(new Error("XHR failed"));
        xhr.send();
      });
      await (await fetch("/large")).text();
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("image failed"));
          image.src = "/image.png";
          document.body.append(image);
        }),
        new Promise<void>((resolve, reject) => {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.onload = () => resolve();
          link.onerror = () => reject(new Error("CSS failed"));
          link.href = "/style.css";
          document.head.append(link);
        }),
      ]);
    });
    await expect
      .poll(async () => (await request("status")).value?.count)
      .toBe(3);
    await site.waitForTimeout(500);
    const stopped = await request("stop");
    expect(stopped).toMatchObject({
      ok: true,
      value: { state: "stopped", reason: "stopped", count: 3 },
    });
    const snapshot: CaptureSnapshot = stopped.value;
    const byUrl = (path: string) => {
      const record = snapshot.records.find((r) => r.url === base + path);
      expect(record).toBeDefined();
      return record!;
    };
    const header = (headers: Record<string, string>, name: string) =>
      Object.entries(headers).find(
        ([key]) => key.toLowerCase() === name.toLowerCase(),
      )?.[1];
    const post = byUrl("/post");
    expect(post).toMatchObject({
      method: "POST",
      resourceType: "Fetch",
      status: 201,
      requestBody: '{"hello":"world"}',
      responseBody: '{"result":"created"}',
      bodyEncoding: "utf8",
      responseBodyTruncated: false,
    });
    expect(header(post.requestHeaders, "authorization")).toBe(
      "Bearer e2e-secret",
    );
    expect(header(post.requestHeaders, "cookie")).toContain(
      "capture_cookie=cookie-value",
    );
    expect(header(post.requestHeaders, "x-capture-request")).toBe(
      "request-value",
    );
    expect(header(post.responseHeaders, "x-capture-response")).toBe(
      "response-value",
    );
    expect(byUrl("/missing")).toMatchObject({
      method: "GET",
      resourceType: "XHR",
      status: 404,
      responseBody: "missing resource",
    });
    expect(byUrl("/large")).toMatchObject({
      method: "GET",
      status: 200,
      responseBody: large.slice(0, 100 * 1024),
      responseBodyTruncated: true,
    });
    expect(snapshot.records.map((r) => r.url).sort()).toEqual(
      [base + "/large", base + "/missing", base + "/post"].sort(),
    );
    expect((await request("status")).value).toMatchObject({
      state: "stopped",
      count: 3,
    });
    expect((await request("stop")).value).toEqual(snapshot);
    expect(await request("status", "other-session")).toMatchObject({
      ok: false,
    });
    expect(await request("stop", "other-session")).toMatchObject({ ok: false });

    await panel.waitForSelector('iframe[src$="sandbox.html"]', {
      state: "attached",
    });
    const result = await panel.evaluate(async (records) => {
      const frame = document.querySelector<HTMLIFrameElement>(
        'iframe[src$="sandbox.html"]',
      )!;
      return await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          window.removeEventListener("message", receive);
          reject(new Error("Missing sandbox response"));
        }, 15000);
        const receive = (event: MessageEvent) => {
          if (
            event.source !== frame.contentWindow ||
            event.data?.id !== "network-analysis"
          )
            return;
          clearTimeout(timer);
          window.removeEventListener("message", receive);
          resolve(event.data);
        };
        window.addEventListener("message", receive);
        frame.contentWindow!.postMessage(
          {
            id: "network-analysis",
            code: "export default async function(records) { return records.filter(r => r.status >= 400 && r.status < 500).map(r => ({url: r.url, status: r.status})); }",
            input: records,
          },
          "*",
        );
      });
    }, snapshot.records);
    expect(result).toMatchObject({
      ok: true,
      result: [{ url: base + "/missing", status: 404 }],
    });

    const second = await request("start", "network-e2e", tabId);
    expect(second).toMatchObject({
      ok: true,
      value: { state: "capturing", count: 0 },
    });
    expect(second.value.captureId).not.toBe(snapshot.captureId);
    await site.close();
    await expect
      .poll(
        async () => ((await request("status")).value as CaptureStatus)?.state,
      )
      .toBe("stopped");
    const closed = await request("stop");
    expect(closed).toMatchObject({
      ok: true,
      value: { state: "stopped", count: 0, records: [] },
    });
    expect(["tab_closed", "debugger_detached"]).toContain(closed.value.reason);
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
