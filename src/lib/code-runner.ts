import { browser } from "wxt/browser";

export interface CodeResponse {
  id: string;
  ok: boolean;
  result: unknown;
  logs: string[];
  error: string | null;
}

interface PendingRun {
  code: string;
  input: unknown;
  resolve: (response: CodeResponse) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** A single sandbox frame, shared by concurrent calls in one side panel. */
export class CodeRunner {
  private iframe: HTMLIFrameElement;
  private pending = new Map<string, PendingRun>();
  private ready = false;
  private failure: Error | undefined;
  private startupTimer: ReturnType<typeof setTimeout>;
  private requestTimeoutMs: number;

  constructor(
    options: { startupTimeoutMs?: number; requestTimeoutMs?: number } = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.iframe = document.createElement("iframe");
    this.iframe.hidden = true;
    this.iframe.src = browser.runtime.getURL("/sandbox.html");
    // The sandbox may announce readiness before the iframe's load event. Install
    // the listener before navigation, and never reset readiness on load.
    window.addEventListener("message", this.onMessage);
    this.iframe.addEventListener("error", this.onError);
    this.startupTimer = setTimeout(
      () => this.close(new Error("Code sandbox startup timed out")),
      options.startupTimeoutMs ?? 10_000,
    );
    try {
      (document.body ?? document.documentElement).append(this.iframe);
    } catch (error) {
      this.close(error instanceof Error ? error : new Error(String(error)));
    }
  }

  runCode(code: string, input: unknown): Promise<CodeResponse> {
    if (this.failure) return Promise.reject(this.failure);
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const pending: PendingRun = { code, input, resolve, reject };
      this.pending.set(id, pending);
      if (this.ready) this.send(id, pending);
    });
  }

  dispose() {
    this.close(new Error("Code sandbox disposed"));
  }

  private onError = () => this.close(new Error("Code sandbox failed to load"));

  private onMessage = (event: MessageEvent) => {
    // The sandbox has an opaque origin; source, not origin, authenticates it.
    if (
      !this.iframe.contentWindow ||
      event.source !== this.iframe.contentWindow
    )
      return;
    const data: unknown = event.data;
    if (!data || typeof data !== "object") return;
    if ("type" in data && data.type === "ama:sandbox-ready") {
      if (this.ready) return;
      this.ready = true;
      clearTimeout(this.startupTimer);
      for (const [id, pending] of this.pending) this.send(id, pending);
      return;
    }
    if (
      !("id" in data) ||
      typeof data.id !== "string" ||
      !("ok" in data) ||
      typeof data.ok !== "boolean" ||
      !("result" in data) ||
      !("logs" in data) ||
      !Array.isArray(data.logs) ||
      !data.logs.every((log) => typeof log === "string") ||
      !("error" in data) ||
      (data.error !== null && typeof data.error !== "string")
    )
      return;
    const pending = this.pending.get(data.id);
    if (!pending || pending.timer === undefined) return;
    clearTimeout(pending.timer);
    this.pending.delete(data.id);
    pending.resolve(data as CodeResponse);
  };

  private send(id: string, pending: PendingRun) {
    pending.timer = setTimeout(() => {
      this.pending.delete(id);
      pending.reject(new Error("Code sandbox response timed out"));
    }, this.requestTimeoutMs);
    try {
      if (!this.iframe.contentWindow)
        throw new Error("Code sandbox unavailable");
      this.iframe.contentWindow.postMessage(
        { id, code: pending.code, input: pending.input },
        "*",
      );
    } catch (error) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private close(error: Error) {
    if (this.failure) return;
    this.failure = error;
    clearTimeout(this.startupTimer);
    window.removeEventListener("message", this.onMessage);
    this.iframe.removeEventListener("error", this.onError);
    this.iframe.remove();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

let runner: CodeRunner | undefined;

/** Explicitly called by the side-panel entrypoint, never at module import. */
export function initializeCodeRunner() {
  return (runner ??= new CodeRunner());
}

export function runCode(code: string, input: unknown): Promise<CodeResponse> {
  return initializeCodeRunner().runCode(code, input);
}

export function disposeCodeRunner() {
  runner?.dispose();
  runner = undefined;
}
