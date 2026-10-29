import type { CaptureSnapshot, CaptureStatus, NetworkRecord } from "./types";

const BODY_LIMIT = 100 * 1024;
const META_LIMIT = 64 * 1024;
const encoder = new TextEncoder();
function truncate(text: string, limit: number): [string, boolean] {
  const bytes = encoder.encode(text);
  if (bytes.length <= limit) return [text, false];
  return [
    new TextDecoder().decode(bytes.subarray(0, limit)).replace(/\uFFFD$/, ""),
    true,
  ];
}
export interface CaptureAdapter {
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  command(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<any>;
  resolveTab(tabId?: number): Promise<{ id: number; url: string }>;
  notify(status: CaptureStatus): void;
}
type EventData = Record<string, any>;
export class NetworkCapture {
  private statusValue: CaptureStatus = {
    captureId: null,
    tabId: null,
    state: "stopped",
    count: 0,
    limitReached: false,
    droppedCount: 0,
  };
  private owner: string | null = null;
  private records = new Map<string, NetworkRecord>();
  private pending = new Set<Promise<void>>();
  private early = new Map<
    string,
    { request?: Record<string, string>; response?: Record<string, string> }
  >();
  private unknown = new Map<string, EventData>();
  private redirects = new Set<string>();
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private adapter: CaptureAdapter,
    private drainMs = 2000,
  ) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.catch(() => {});
    return result;
  }
  private publish() {
    this.adapter.notify(this.status());
  }
  status(sessionId?: string): CaptureStatus {
    if (sessionId && this.owner && sessionId !== this.owner)
      throw new Error("Capture belongs to another session");
    return { ...this.statusValue };
  }
  private snapshot(): CaptureSnapshot {
    return structuredClone({
      ...this.status(),
      records: [...this.records.values()],
    });
  }
  start(sessionId: string, tabId?: number): Promise<CaptureStatus> {
    return this.serial(async () => {
      if (!sessionId) throw new Error("Invalid session");
      if (this.statusValue.state !== "stopped") {
        if (
          this.owner === sessionId &&
          (tabId === undefined || tabId === this.statusValue.tabId)
        )
          return this.status();
        throw new Error("Another capture is active");
      }
      const tab = await this.adapter.resolveTab(tabId);
      if (
        !Number.isInteger(tab.id) ||
        tab.id < 0 ||
        !/^https?:\/\//i.test(tab.url)
      )
        throw new Error("Only HTTP(S) tabs can be captured");
      this.owner = sessionId;
      this.records.clear();
      this.early.clear();
      this.unknown.clear();
      this.redirects.clear();
      this.pending.clear();
      const generation = ++this.generation;
      this.statusValue = {
        captureId: globalThis.crypto.randomUUID(),
        tabId: tab.id,
        state: "starting",
        count: 0,
        startedAt: Date.now(),
        limitReached: false,
        droppedCount: 0,
      };
      this.publish();
      let attached = false;
      try {
        await this.adapter.attach(tab.id);
        attached = true;
        if (generation !== this.generation)
          throw new Error("Capture detached during startup");
        await this.adapter.command(tab.id, "Network.enable");
        if (generation !== this.generation)
          throw new Error("Capture detached during startup");
        this.statusValue.state = "capturing";
        this.publish();
        return this.status();
      } catch {
        if (attached) {
          try {
            await this.adapter.detach(tab.id);
          } catch {}
        }
        if (generation === this.generation) {
          ++this.generation;
          this.statusValue.state = "stopped";
          this.statusValue.error = "Unable to start network capture";
          this.publish();
        }
        throw new Error("Unable to start network capture");
      }
    });
  }
  stop(sessionId: string): Promise<CaptureSnapshot> {
    return this.serial(async () => {
      this.status(sessionId);
      if (!this.owner) throw new Error("NO_CAPTURE");
      if (this.statusValue.state === "stopped") return this.snapshot();
      this.statusValue.state = "stopping";
      this.publish();
      await Promise.race([
        Promise.allSettled([...this.pending]),
        new Promise<void>((resolve) => setTimeout(resolve, this.drainMs)),
      ]);
      ++this.generation;
      for (const r of this.records.values())
        if (r.finishedAt && r.responseBody === null && !r.bodyError)
          r.bodyError = "Response body unavailable";
      const tab = this.statusValue.tabId!;
      try {
        await this.adapter.detach(tab);
      } catch {}
      this.statusValue.state = "stopped";
      this.statusValue.reason = "stopped";
      this.publish();
      return this.snapshot();
    });
  }
  clear(sessionId: string): Promise<void> {
    return this.stop(sessionId)
      .then(() =>
        this.serial(async () => {
          if (this.owner !== sessionId)
            throw new Error("Capture belongs to another session");
          this.owner = null;
          this.records.clear();
          this.early.clear();
          this.unknown.clear();
          this.statusValue = {
            captureId: null,
            tabId: null,
            state: "stopped",
            count: 0,
            limitReached: false,
            droppedCount: 0,
          };
          this.publish();
        }),
      )
      .catch((e) => {
        if (e.message !== "NO_CAPTURE") throw e;
      });
  }
  detached(tabId: number, reason: string) {
    if (
      tabId !== this.statusValue.tabId ||
      this.statusValue.state === "stopped" ||
      this.statusValue.state === "stopping"
    )
      return;
    ++this.generation;
    for (const r of this.records.values())
      if (!r.finishedAt || (r.responseBody === null && !r.bodyError))
        r.bodyError = "Capture disconnected";
    this.statusValue.state = "stopped";
    this.statusValue.reason =
      reason === "tab_closed" ? "tab_closed" : "debugger_detached";
    this.publish();
  }
  private metadata(r: NetworkRecord) {
    let remaining = META_LIMIT;
    const take = (v: string) => {
      const [s, cut] = truncate(v, Math.max(0, remaining));
      remaining -= encoder.encode(s).length;
      if (cut) r.metadataTruncated = true;
      return s;
    };
    r.method = take(r.method);
    r.url = take(r.url);
    const headers = (h: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(h)) {
        if (remaining <= 0) {
          r.metadataTruncated = true;
          break;
        }
        const key = take(k);
        if (key) out[key] = take(String(v));
      }
      return out;
    };
    r.requestHeaders = headers(r.requestHeaders);
    r.responseHeaders = headers(r.responseHeaders);
    if (r.requestBody !== null) r.requestBody = take(r.requestBody);
  }
  private track(p: Promise<void>) {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }
  event(tabId: number, method: string, p: EventData) {
    if (
      tabId !== this.statusValue.tabId ||
      !["capturing", "stopping"].includes(this.statusValue.state) ||
      typeof p.requestId !== "string" ||
      p.requestId.length > 1024
    )
      return;
    const id = p.requestId;
    let r = this.records.get(id);
    const generation = this.generation;
    if (
      method === "Network.requestWillBeSentExtraInfo" ||
      method === "Network.responseReceivedExtraInfo"
    ) {
      if (this.redirects.has(id)) return;
      const request = method.includes("requestWill");
      // Bound early headers before retaining them.
      const safe: Record<string, string> = {};
      let n = 0;
      for (const [k, v] of Object.entries(p.headers || {})) {
        const [key] = truncate(k, 4096);
        const [value] = truncate(String(v), 8192);
        n += encoder.encode(key + value).length;
        if (n > META_LIMIT) break;
        safe[key] = value;
      }
      if (r) {
        if (request) r.requestHeaders = safe;
        else r.responseHeaders = safe;
        this.metadata(r);
      } else if (this.early.size < 200) {
        const item = this.early.get(id) || {};
        if (request) item.request = safe;
        else item.response = safe;
        this.early.set(id, item);
      }
      return;
    }
    if (method === "Network.requestWillBeSent") {
      if (p.redirectResponse && r) {
        this.redirects.add(id);
        this.early.delete(id);
        r.requestHeaders = {};
        r.responseHeaders = {};
        r.status = null;
        r.responseBody = null;
        r.bodyError = undefined;
        r.finishedAt = undefined;
        r.bodyEncoding = "utf8";
        r.responseBodyTruncated = false;
      }
      if (!r && this.statusValue.state !== "capturing") return;
      if (!r && p.type !== "XHR" && p.type !== "Fetch") {
        if (!p.type && this.unknown.size < 200) {
          const request = p.request || {};
          this.unknown.set(id, {
            request: {
              method: truncate(String(request.method || ""), 128)[0],
              url: truncate(String(request.url || ""), 8192)[0],
            },
            timestamp: p.timestamp,
          });
        }
        return;
      }
      const req = p.request || {};
      if (!/^https?:\/\//i.test(String(req.url || ""))) return;
      if (!r) {
        if (this.records.size >= 200) {
          this.statusValue.limitReached = true;
          this.statusValue.droppedCount++;
          this.early.delete(id);
          this.publish();
          return;
        }
        r = {
          requestId: truncate(id, 1024)[0],
          method: "",
          url: "",
          resourceType: p.type,
          status: null,
          requestHeaders: {},
          responseHeaders: {},
          requestBody: null,
          responseBody: null,
          bodyEncoding: "utf8",
          responseBodyTruncated: false,
          metadataTruncated: false,
          startedAt: Date.now(),
        };
        this.records.set(id, r);
        this.statusValue.count = this.records.size;
        this.publish();
      }
      r.method = String(req.method || "");
      r.url = String(req.url || "");
      r.requestHeaders = this.early.get(id)?.request || req.headers || {};
      r.requestBody = typeof req.postData === "string" ? req.postData : null;
      this.metadata(r);
      if (req.hasPostData && r.requestBody === null) {
        const target = r;
        this.track(
          this.adapter
            .command(tabId, "Network.getRequestPostData", { requestId: id })
            .then((v) => {
              if (generation === this.generation) {
                target.requestBody = String(v.postData || "");
                this.metadata(target);
              }
            })
            .catch(() => {
              if (generation === this.generation)
                target.bodyError = "Request body unavailable";
            }),
        );
      }
      return;
    }
    if (
      method === "Network.responseReceived" &&
      !r &&
      (p.type === "XHR" || p.type === "Fetch")
    ) {
      const prior = this.unknown.get(id);
      this.unknown.delete(id);
      if (prior) {
        this.event(tabId, "Network.requestWillBeSent", {
          ...prior,
          requestId: id,
          type: p.type,
        });
        r = this.records.get(id);
      }
    }
    if (!r) {
      if (
        method === "Network.responseReceived" ||
        method === "Network.loadingFailed"
      ) {
        this.unknown.delete(id);
        this.early.delete(id);
      }
      return;
    }
    if (method === "Network.responseReceived") {
      r.status =
        typeof p.response?.status === "number" ? p.response.status : null;
      r.responseHeaders =
        this.early.get(id)?.response || p.response?.headers || {};
      this.early.delete(id);
      this.metadata(r);
    }
    if (method === "Network.loadingFailed") {
      r.finishedAt = Date.now();
      r.errorText = "Network request failed";
      r.bodyError = "Response body unavailable";
    }
    if (method === "Network.loadingFinished") {
      r.finishedAt = Date.now();
      const target = r;
      this.track(
        this.adapter
          .command(tabId, "Network.getResponseBody", { requestId: id })
          .then((v) => {
            if (generation !== this.generation) return;
            if (v.base64Encoded) {
              const binary = atob(v.body);
              const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
              const mime =
                Object.entries(target.responseHeaders).find(
                  ([k]) => k.toLowerCase() === "content-type",
                )?.[1] || "";
              if (
                /^(text\/|application\/(json|javascript|xml|[^;]+\+json))/i.test(
                  mime,
                )
              ) {
                const text = new TextDecoder().decode(bytes);
                [target.responseBody, target.responseBodyTruncated] = truncate(
                  text,
                  BODY_LIMIT,
                );
              } else {
                target.bodyEncoding = "base64";
                target.responseBodyTruncated = bytes.length > BODY_LIMIT;
                let s = "";
                for (const b of bytes.subarray(0, BODY_LIMIT))
                  s += String.fromCharCode(b);
                target.responseBody = btoa(s);
              }
            } else
              [target.responseBody, target.responseBodyTruncated] = truncate(
                String(v.body || ""),
                BODY_LIMIT,
              );
          })
          .catch(() => {
            if (generation === this.generation)
              target.bodyError = "Response body unavailable";
          }),
      );
    }
  }
}
