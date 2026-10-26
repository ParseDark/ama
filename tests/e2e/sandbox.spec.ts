import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("sandbox runs modules, isolates requests, reports errors and terminates loops", async () => {
  const extension = resolve(".output/chrome-mv3");
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  expect(manifest.sandbox.pages).toContain("sandbox.html");
  expect(manifest.content_security_policy.sandbox).toContain("https://esm.sh");
  const profile = await mkdtemp(join(tmpdir(), "ama-sandbox-"));
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : { channel: "chromium" }),
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    const sw =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = new URL(sw.url()).host;
    // Stub only the CDN response, while exercising the real module loader and CSP.
    await context.route("https://esm.sh/ama-test-package", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "export const double = value => value * 2;",
      }),
    );
    await context.route("https://api.example.com/data", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ fetched: true }),
      }),
    );
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.waitForSelector('iframe[src$="sandbox.html"]', {
      state: "attached",
    });
    // Exercise the real postMessage/iframe/Worker boundary in the production build.
    const results = await panel.evaluate(async () => {
      const frame = document.querySelector<HTMLIFrameElement>(
        'iframe[src$="sandbox.html"]',
      )!;
      const run = (id: string, code: string, input: unknown = null) =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Missing sandbox response")),
            15000,
          );
          const receive = (event: MessageEvent) => {
            if (event.source !== frame.contentWindow || event.data?.id !== id)
              return;
            clearTimeout(timer);
            window.removeEventListener("message", receive);
            resolve(event.data);
          };
          window.addEventListener("message", receive);
          frame.contentWindow!.postMessage({ id, code, input }, "*");
        });
      return await Promise.all([
        run(
          "sum",
          'export default async function(input) { console.log("sum", input); return input.reduce((a,b)=>a+b,0); }',
          [1, 2, 3],
        ),
        run(
          "isolation",
          "export default async function() { return { dom: typeof document, extension: typeof chrome }; }",
        ),
        run(
          "throw",
          'export default async function() { console.warn("before error"); throw new Error("boom"); }',
        ),
        run("json", "export default async function() { return 1n; }"),
        run("missing", "export const value = 1;"),
        run(
          "npm",
          "import { double } from 'ama-test-package'; export default async function(input) { const dynamic = await import('ama-test-package'); return [double(input), dynamic.double(input)]; }",
          21,
        ),
        run(
          "loop",
          'export default async function() { console.log("loop"); while(true) {} }',
        ),
        run(
          "fetch",
          "export default async function() { return await (await fetch('https://api.example.com/data')).json(); }",
        ),
      ]);
    });
    expect(results[0]).toMatchObject({
      id: "sum",
      ok: true,
      result: 6,
      logs: ["sum [1,2,3]"],
      error: null,
    });
    expect(results[1]).toMatchObject({
      ok: true,
      result: { dom: "undefined", extension: "undefined" },
    });
    expect(results[2]).toMatchObject({
      ok: false,
      error: "boom",
      logs: ["before error"],
    });
    expect(results[3].ok).toBe(false);
    expect(results[4]).toMatchObject({
      ok: false,
      error: "Code must export default async function(input).",
    });
    expect(results[5]).toMatchObject({ ok: true, result: [42, 42] });
    expect(results[7]).toMatchObject({ ok: true, result: { fetched: true } });
    expect(results[6]).toMatchObject({
      ok: false,
      logs: ["loop"],
      error: "Execution timed out after 10s.",
    });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
