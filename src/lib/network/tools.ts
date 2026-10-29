import { tool } from "ai";
import { z } from "zod";
import type { DataActions, DataDescriptor } from "../data/actions";
import type { RunContext } from "../run-context";
import { networkClient, type NetworkClient } from "./client";
import type { CaptureSnapshot, NetworkRecord } from "./types";

const BATCH_BYTES = 8 * 1024 * 1024;
const RESULT_BYTES = 256 * 1024;
const bytes = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v)).length;
const limits = {
  maxRecords: 200,
  maxResponseBytes: 100 * 1024,
  batchBytes: BATCH_BYTES,
  maxDataRefs: 8,
  previewBytes: RESULT_BYTES,
};
const warning =
  "Headers, URLs and bodies may contain sensitive data and are not redacted. Data is bounded by capture limits.";
type Ref = DataDescriptor & { batchIndex: number; count: number };
type Entry = {
  snapshot: CaptureSnapshot;
  batches: NetworkRecord[][];
  refs: Ref[];
  task?: Promise<void>;
};
// Session and capture IDs are both required: no cross-session cache access.
const cache = new Map<string, Entry>();
function batchesFor(records: NetworkRecord[]) {
  const batches: NetworkRecord[][] = [];
  let batch: NetworkRecord[] = [],
    used = 2;
  for (const record of records) {
    const n = bytes(record);
    if (n + 2 > BATCH_BYTES) throw new Error("Record exceeds batch capacity");
    if (used + (batch.length ? 1 : 0) + n > BATCH_BYTES) {
      batches.push(batch);
      batch = [];
      used = 2;
    }
    used += (batch.length ? 1 : 0) + n;
    batch.push(record);
  }
  if (batch.length) batches.push(batch);
  if (batches.length > 8) throw new Error("Capture exceeds reference capacity");
  return batches;
}
function previews(records: NetworkRecord[], chars: number, base: object) {
  const rows = records.slice(0, 200).map((r, index) => {
    const body = Array.from(r.responseBody ?? "");
    return {
      index,
      url: r.url,
      method: r.method,
      status: r.status,
      responsePreview: body.slice(0, chars).join(""),
      previewTruncated: body.length > chars || r.responseBodyTruncated,
      urlTruncated: false,
      bodyEncoding: r.bodyEncoding,
    };
  });
  // A fair per-row budget prevents a few huge URLs from starving later records.
  const cap = Math.max(
    0,
    Math.floor(
      (RESULT_BYTES - bytes({ ...base, records: [] }) - 2048) /
        Math.max(1, rows.length),
    ),
  );
  for (const row of rows) {
    if (bytes(row) <= cap) continue;
    row.previewTruncated ||= row.responsePreview.length > 0;
    row.responsePreview = "";
    if (bytes(row) > cap) {
      const chars = Array.from(row.url);
      let lo = 0,
        hi = chars.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        row.url = chars.slice(0, mid).join("");
        if (bytes(row) <= cap) lo = mid;
        else hi = mid - 1;
      }
      row.url = chars.slice(0, lo).join("");
      row.urlTruncated = lo < chars.length;
    }
  }
  return rows;
}

export function createNetworkTools(
  chatId: string,
  data: DataActions,
  run: Pick<RunContext, "startTabId">,
  deps: { client?: NetworkClient; dangerMode?: boolean } = {},
) {
  const client = deps.client ?? networkClient;
  return {
    capture_network_start: tool({
      description:
        "Start capturing current tab network requests and responses. Requires approval; a bounded preview is sent to the model. First start, then have the user perform an action (or use an approved browser action), then stop and analyze dataRefs with run_js. Does not refresh or operate the page. Headers, URLs and bodies may contain sensitive data and are not redacted; retained data is bounded.",
      inputSchema: z.object({}).strict(),
      needsApproval: !deps.dangerMode,
      execute: async (_args, options) => {
        options.abortSignal?.throwIfAborted();
        if (run.startTabId === undefined)
          throw new Error("No current tab available for network capture");
        const result = await client.start(chatId, run.startTabId);
        if (options.abortSignal?.aborted) {
          await client.stop(chatId);
          options.abortSignal.throwIfAborted();
        }
        if (result.state !== "capturing" || !result.captureId)
          throw new Error(result.error ?? "Network capture did not start");
        return {
          captureId: result.captureId,
          tabId: result.tabId,
          state: result.state,
          startedAt: result.startedAt,
          limits,
          warning,
        };
      },
    }),
    capture_network_stop: tool({
      description:
        "Stop this session's network capture. Returns bounded previews and dataRefs for run_js, not full bodies. Headers, URLs and bodies may contain sensitive information and are not redacted. Capture retention is bounded.",
      inputSchema: z
        .object({
          previewChars: z.number().int().min(0).max(1024).default(256),
        })
        .strict(),
      execute: async ({ previewChars }, options) => {
        options.abortSignal?.throwIfAborted();
        // Always consult the service, including on cache hits, to enforce ownership.
        let snapshot: CaptureSnapshot;
        try {
          snapshot = await client.stop(chatId);
        } catch (error) {
          if (error instanceof Error && error.message === "NO_CAPTURE")
            return { ok: false as const, error: "NO_CAPTURE" };
          throw error;
        }
        if (!snapshot.captureId)
          return { ok: false as const, error: "NO_CAPTURE" };
        const key = JSON.stringify([chatId, snapshot.captureId]);
        let entry = cache.get(key);
        try {
          if (!entry) {
            entry = {
              snapshot,
              batches: batchesFor(snapshot.records),
              refs: [],
            };
            cache.set(key, entry);
          }
          const current = entry;
          if (!current.task) {
            current.task = (async () => {
              // Check cached refs still belong to a live session (including tombstones).
              for (const ref of current.refs) await data.load(ref.dataId);
              while (current.refs.length < current.batches.length) {
                const index = current.refs.length;
                const descriptor = await data.save(current.batches[index], {
                  source: "capture_network",
                  toolCallId: options.toolCallId,
                });
                // Descriptor preview can contain complete bodies: do not send it to the model.
                current.refs.push({
                  ...descriptor,
                  preview: null,
                  previewTruncated: true,
                  batchIndex: index,
                  count: current.batches[index].length,
                });
              }
            })().finally(() => {
              current.task = undefined;
            });
          }
          await current.task;
          const s = current.snapshot;
          const base = {
            ok: true as const,
            captureId: s.captureId,
            tabId: s.tabId,
            state: s.state,
            reason: s.reason,
            totalCount: s.records.length,
            limitReached: s.limitReached,
            droppedCount: s.droppedCount,
            dataRefs: current.refs,
            warning,
          };
          return {
            ...base,
            records: previews(s.records, previewChars ?? 256, base),
          };
        } catch {
          return {
            ok: false as const,
            error: "DATA_STORE_FAILED",
            captureId: snapshot.captureId,
            state: snapshot.state,
            retryable: true,
          };
        }
      },
    }),
  };
}
