import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { createDataActions } from "@/lib/data/actions";
import { createCodeTools } from "@/lib/code-tools";
import { createNetworkTools } from "@/lib/network/tools";

it("loads the retained capture with original headers into run_js, including tail 4xx", async () => {
  const records = Array.from({ length: 100 }, (_, i) => ({
    requestId: String(i),
    method: "GET",
    url: `https://example.test/${i}`,
    status: i === 99 ? 404 : 200,
    resourceType: "Fetch",
    requestHeaders: { Cookie: "private", Authorization: "bearer-token" },
    responseHeaders: { "Set-Cookie": "session=value" },
    requestBody: null,
    responseBody: "x".repeat(500) + (i === 99 ? "TAIL" : ""),
    bodyEncoding: "utf8",
    responseBodyTruncated: false,
    metadataTruncated: false,
    startedAt: 1,
  }));
  const client = {
    stop: async () => ({
      captureId: "pipeline-network",
      tabId: 1,
      state: "stopped",
      count: 100,
      limitReached: false,
      droppedCount: 0,
      records,
    }),
  } as any;
  const data = createDataActions({ sessionId: "pipeline-network" });
  const capture = (await createNetworkTools(
    "pipeline-network",
    data,
    { startTabId: 1 },
    { client },
  ).capture_network_stop.execute!({ previewChars: 2 }, {
    toolCallId: "stop",
  } as any)) as any;
  expect(JSON.stringify(capture)).not.toContain("TAIL");
  const execute = vi.fn(async (_code: string, input: any) => ({
    id: "run",
    ok: true,
    result: Object.values(input.data)
      .flat()
      .filter((r: any) => r.status >= 400)
      .map((r: any) => ({
        url: r.url,
        body: r.responseBody,
        cookie: r.requestHeaders.Cookie,
        authorization: r.requestHeaders.Authorization,
        setCookie: r.responseHeaders["Set-Cookie"],
      })),
    logs: [],
    error: null,
  }));
  const result = (await createCodeTools(data, execute).run_js.execute!(
    {
      code: "code",
      data: Object.fromEntries(
        capture.dataRefs.map((r: any, i: number) => [`network${i}`, r.dataId]),
      ),
    },
    { toolCallId: "run" } as any,
  )) as any;
  const output = (await data.load(result.result.dataId)) as any[];
  expect(output).toHaveLength(1);
  expect(output[0].url.endsWith("/99")).toBe(true);
  expect(output[0].body.endsWith("TAIL")).toBe(true);
  expect(output[0].cookie).toBe("private");
  expect(output[0].authorization).toBe("bearer-token");
  expect(output[0].setCookie).toBe("session=value");
});
