import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createDataActions } from "@/lib/data/actions";
import { createNetworkTools } from "@/lib/network/tools";

const opts = { toolCallId: "test" } as any;
const record = (n: number, body = "😀中文secret") => ({
  requestId: String(n),
  method: "GET",
  url: `https://example.test/${n}`,
  resourceType: "Fetch",
  status: 200,
  requestHeaders: { Authorization: "token" },
  responseHeaders: { "Set-Cookie": "cookie" },
  requestBody: null,
  responseBody: body,
  bodyEncoding: "utf8",
  responseBodyTruncated: false,
  metadataTruncated: false,
  startedAt: 1,
});
const fixture = (id: string, records: any[] = []) => {
  const snapshot = {
    captureId: id,
    tabId: 1,
    state: "stopped",
    count: records.length,
    limitReached: false,
    droppedCount: 0,
    records,
  };
  return {
    start: vi.fn(async () => ({ ...snapshot, state: "capturing" })),
    stop: vi.fn(async () => snapshot),
    status: vi.fn(),
    clear: vi.fn(),
  } as any;
};
const make = (id: string, records: any[] = []) => {
  const client = fixture(id, records),
    data = createDataActions({ sessionId: id });
  return {
    client,
    data,
    tools: createNetworkTools(id, data, { startTabId: 1 }, { client }),
  };
};
it("validates schemas and requires approval unless danger mode", () => {
  const { tools, client, data } = make("schemas");
  expect(tools.capture_network_start.needsApproval).toBe(true);
  expect(
    createNetworkTools("schemas", data, {}, { client, dangerMode: true })
      .capture_network_start.needsApproval,
  ).toBe(false);
  const start = tools.capture_network_start.inputSchema as z.ZodType;
  const stop = tools.capture_network_stop.inputSchema as z.ZodType;
  expect(start.safeParse({ tabId: 2 }).success).toBe(false);
  expect(stop.parse({})).toEqual({ previewChars: 256 });
  for (const n of [-1, 1025, 1.5])
    expect(stop.safeParse({ previewChars: n }).success).toBe(false);
  for (const n of [0, 1024])
    expect(stop.safeParse({ previewChars: n }).success).toBe(true);
});
it("cleans up when cancelled during attach", async () => {
  const { tools, client } = make("cancel");
  const controller = new AbortController();
  client.start.mockImplementation(async () => {
    controller.abort();
    return { captureId: "cancel", state: "capturing" };
  });
  await expect(
    tools.capture_network_start.execute!(
      {},
      { ...opts, abortSignal: controller.signal },
    ),
  ).rejects.toThrow();
  expect(client.stop).toHaveBeenCalledWith("cancel");
});
it("handles no capture, empty captures and ownership errors", async () => {
  const { tools, client } = make("empty");
  expect(
    (
      (await tools.capture_network_stop.execute!(
        { previewChars: 0 },
        opts,
      )) as any
    ).dataRefs,
  ).toEqual([]);
  client.stop.mockResolvedValueOnce({ captureId: null, records: [] });
  expect(
    await tools.capture_network_stop.execute!({ previewChars: 0 }, opts),
  ).toEqual({ ok: false, error: "NO_CAPTURE" });
  client.stop.mockRejectedValueOnce(new Error("ownership denied"));
  await expect(
    tools.capture_network_stop.execute!({ previewChars: 0 }, opts),
  ).rejects.toThrow("ownership denied");
});
it("preserves headers in storage and returns codepoint previews under the total budget", async () => {
  const { tools, data } = make(
    "preview",
    Array.from({ length: 200 }, (_, n) => ({
      ...record(n, "😀".repeat(1024)),
      url: "https://x/" + "中".repeat(5000),
    })),
  );
  const result = (await tools.capture_network_stop.execute!(
    { previewChars: 1024 },
    opts,
  )) as any;
  expect(
    new TextEncoder().encode(JSON.stringify(result)).length,
  ).toBeLessThanOrEqual(256 * 1024);
  expect(result.records).toHaveLength(200);
  const saved = (await data.load(result.dataRefs[0].dataId)) as any[];
  expect(saved[0].requestHeaders.Authorization).toBe("token");
  expect(saved[0].responseHeaders["Set-Cookie"]).toBe("cookie");
  expect(JSON.stringify(result)).not.toContain("token");
  const other = make("unicode", [record(0)]);
  const unicode = (await other.tools.capture_network_stop.execute!(
    { previewChars: 1 },
    opts,
  )) as any;
  expect(unicode.records[0].responsePreview).toBe("😀");
  expect(unicode.records[0].previewTruncated).toBe(true);
});
it("splits actual JSON bytes and reuses partial saves on retry and across factories", async () => {
  const id = "batches",
    records = Array.from({ length: 180 }, (_, n) =>
      record(n, '"'.repeat(50000)),
    );
  const { tools, data, client } = make(id, records);
  const original = data.save.bind(data);
  const save = vi.spyOn(data, "save");
  let calls = 0;
  save.mockImplementation(async (...args) => {
    if (++calls === 2) throw new Error("failed");
    return original(...args);
  });
  expect(
    (
      (await tools.capture_network_stop.execute!(
        { previewChars: 0 },
        opts,
      )) as any
    ).error,
  ).toBe("DATA_STORE_FAILED");
  const result = (await createNetworkTools(
    id,
    data,
    { startTabId: 1 },
    { client },
  ).capture_network_stop.execute!({ previewChars: 0 }, opts)) as any;
  expect(result.dataRefs.length).toBeGreaterThan(2);
  expect(
    result.dataRefs.every((ref: any) => ref.bytes <= 8 * 1024 * 1024),
  ).toBe(true);
  expect(result.dataRefs.reduce((n: number, r: any) => n + r.count, 0)).toBe(
    180,
  );
  const again = (await tools.capture_network_stop.execute!(
    { previewChars: 0 },
    opts,
  )) as any;
  expect(again.dataRefs).toEqual(result.dataRefs);
  expect(save).toHaveBeenCalledTimes(result.dataRefs.length + 1);
});
