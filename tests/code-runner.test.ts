import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import {
  CodeRunner,
  disposeCodeRunner,
  initializeCodeRunner,
  runCode,
} from "@/lib/code-runner";

let runner: CodeRunner | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
    const element = create(tag === "iframe" ? "div" : tag, options);
    if (tag === "iframe") {
      // happy-dom disables iframe navigation; use a DOM stand-in with the same
      // messaging interface, without triggering its native iframe loader.
      element.setAttribute("data-test-sandbox", "");
      Object.defineProperty(element, "src", { value: "", writable: true });
      Object.defineProperty(element, "contentWindow", {
        value: { postMessage: vi.fn() },
      });
    }
    return element;
  });
});
afterEach(() => {
  runner?.dispose();
  runner = undefined;
  disposeCodeRunner();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function frame() {
  return document.querySelector<HTMLIFrameElement>("[data-test-sandbox]")!;
}
function message(
  data: unknown,
  source: MessageEventSource | null = frame().contentWindow,
) {
  window.dispatchEvent(new MessageEvent("message", { data, source }));
}
function ready() {
  message({ type: "ama:sandbox-ready" });
}
function response(id: string, result: unknown = 42) {
  return { id, ok: true, result, logs: ["done"], error: null };
}

describe("sandbox code runner", () => {
  it("creates one hidden extension frame only on explicit initialization", () => {
    expect(document.querySelector("[data-test-sandbox]")).toBeNull();
    const first = initializeCodeRunner();
    expect(initializeCodeRunner()).toBe(first);
    expect(frame().hidden).toBe(true);
    expect(frame().src).toBe(browser.runtime.getURL("/sandbox.html"));
  });

  it("queues until authenticated ready, including ready before load, and matches concurrent ids", async () => {
    runner = new CodeRunner();
    const post = vi
      .spyOn(frame().contentWindow!, "postMessage")
      .mockImplementation(() => {});
    const a = runner.runCode("first", { a: 1 });
    const b = runner.runCode("second", [2]);
    frame().dispatchEvent(new Event("load"));
    message({ type: "ama:sandbox-ready" }, window);
    expect(post).not.toHaveBeenCalled();
    ready();
    frame().dispatchEvent(new Event("load"));
    ready();
    expect(post).toHaveBeenCalledTimes(2);
    const first = post.mock.calls[0][0];
    const second = post.mock.calls[1][0];
    expect(first).toEqual({
      id: expect.any(String),
      code: "first",
      input: { a: 1 },
    });
    expect(first.id).not.toBe(second.id);
    expect(post.mock.calls[0][1]).toBe("*");
    message(response(first.id), window);
    message({ ...response(first.id), logs: "invalid" });
    message({ ...response(first.id), error: 3 });
    message(response("unknown"));
    message(response(second.id, [2]));
    expect(await b).toEqual(response(second.id, [2]));
    message(response(first.id));
    expect(await a).toEqual(response(first.id));
    message(response(first.id)); // Duplicate replies are ignored.
    const c = runner.runCode("third", null);
    expect(post).toHaveBeenCalledTimes(3); // No second handshake after load.
    const failure = {
      id: post.mock.calls[2][0].id,
      ok: false,
      result: null,
      logs: [],
      error: "boom",
    };
    message(failure);
    expect(await c).toEqual(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a synchronous ready announcement during frame attachment", async () => {
    const append = document.body.append.bind(document.body);
    vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      append(...nodes);
      ready();
    });
    runner = new CodeRunner();
    const post = vi
      .spyOn(frame().contentWindow!, "postMessage")
      .mockImplementation(() => {});
    const promise = runner.runCode("code", null);
    expect(post).toHaveBeenCalledOnce();
    message(response(post.mock.calls[0][0].id));
    await expect(promise).resolves.toMatchObject({ ok: true });
  });

  it("times out startup, removes the frame, and rejects queued and future calls", async () => {
    runner = new CodeRunner({ startupTimeoutMs: 100 });
    const pending = expect(runner.runCode("code", null)).rejects.toThrow(
      "startup timed out",
    );
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(document.querySelector("[data-test-sandbox]")).toBeNull();
    await expect(runner.runCode("late", null)).rejects.toThrow(
      "startup timed out",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds communication time without breaking later runs", async () => {
    runner = new CodeRunner({ requestTimeoutMs: 100 });
    const post = vi
      .spyOn(frame().contentWindow!, "postMessage")
      .mockImplementation(() => {});
    ready();
    const pending = expect(runner.runCode("code", null)).rejects.toThrow(
      "response timed out",
    );
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    message(response(post.mock.calls[0][0].id));
    const next = runner.runCode("next", null);
    message(response(post.mock.calls[1][0].id));
    await expect(next).resolves.toMatchObject({ ok: true });
  });

  it("rejects postMessage failures immediately and clears their timeout", async () => {
    runner = new CodeRunner();
    vi.spyOn(frame().contentWindow!, "postMessage").mockImplementation(() => {
      throw new Error("clone failed");
    });
    ready();
    await expect(runner.runCode("code", null)).rejects.toThrow("clone failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disposes queued and in-flight calls, listeners, frame, and timers", async () => {
    runner = new CodeRunner();
    const queued = expect(runner.runCode("queued", null)).rejects.toThrow(
      "disposed",
    );
    runner.dispose();
    await queued;
    runner = new CodeRunner();
    vi.spyOn(frame().contentWindow!, "postMessage").mockImplementation(
      () => {},
    );
    ready();
    const inflight = expect(runner.runCode("inflight", null)).rejects.toThrow(
      "disposed",
    );
    runner.dispose();
    runner.dispose();
    await inflight;
    expect(document.querySelector("[data-test-sandbox]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await expect(runner.runCode("late", null)).rejects.toThrow("disposed");
  });

  it("rejects queued work on a frame loading error", async () => {
    runner = new CodeRunner();
    const pending = expect(runner.runCode("code", null)).rejects.toThrow(
      "failed to load",
    );
    frame().dispatchEvent(new Event("error"));
    await pending;
    expect(document.querySelector("[data-test-sandbox]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exposes lazy runCode and can initialize again after disposal", async () => {
    initializeCodeRunner();
    vi.spyOn(frame().contentWindow!, "postMessage").mockImplementation(
      () => {},
    );
    ready();
    const pending = expect(runCode("code", null)).rejects.toThrow("disposed");
    disposeCodeRunner();
    await pending;
    initializeCodeRunner();
    expect(frame()).not.toBeNull();
  });
});
