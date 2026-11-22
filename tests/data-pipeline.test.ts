import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { createDataActions } from "@/lib/data/actions";
import { clearDataStore } from "@/lib/data/store";
import { createDataTools } from "@/lib/data/tools";
import { createCodeTools } from "@/lib/code-tools";

beforeEach(async () => {
  await clearDataStore();
});

const success = (result: unknown) => ({
  id: "run",
  ok: true,
  result,
  logs: [],
  error: null,
});
const options = (toolCallId: string) => ({
  toolCallId,
  messages: [],
  context: {},
});

it("discovers a large run_js result and passes its original value, not its preview, to another run", async () => {
  const text = "row\n".repeat(1000) + "tail-marker";
  const data = createDataActions({ sessionId: "pipeline" });
  const execute = vi.fn(async (code, input) =>
    success(code === "generate" ? text : input.data.csv.split("\n").at(-1)),
  );
  const { run_js } = createCodeTools(data, execute);
  const { list_data, inspect_data } = createDataTools(data);
  const first = await run_js.execute!({ code: "generate" }, options("js-1"));
  expect(first).toMatchObject({ ok: true, result: { previewTruncated: true } });

  const listed = await list_data.execute!({}, options("list"));
  if (!("items" in listed)) throw new Error("Expected a single list result");
  const { items } = listed;
  expect(items).toHaveLength(1);
  const [{ dataId, source }] = items;
  expect(source).toBe("run_js");
  expect(items[0]).not.toHaveProperty("preview");
  const excerpt = await inspect_data.execute!(
    { dataId, limit: 6 },
    options("inspect"),
  );
  expect(excerpt).toMatchObject({ preview: "row\nro", previewTruncated: true });
  expect(JSON.stringify({ first, items, excerpt })).not.toContain(
    "tail-marker",
  );
  await expect(
    createDataActions({ sessionId: "other" }).load(dataId),
  ).rejects.toThrow();

  const next = await run_js.execute!(
    { code: "last-row", data: { csv: dataId }, params: {} },
    options("js-2"),
  );
  expect(execute).toHaveBeenLastCalledWith("last-row", {
    data: { csv: text },
    params: {},
  });
  expect(next).toMatchObject({ ok: true, result: { preview: "tail-marker" } });
});

it("rejects oversized run_js results without exposing the data or leaving a dangling ID", async () => {
  const data = createDataActions({
    sessionId: "pipeline",
    limits: { maxEntryBytes: 10 },
  });
  const { run_js } = createCodeTools(data, async () =>
    success("private-marker".repeat(100)),
  );
  const result = await run_js.execute!({ code: "generate" }, options("js-1"));
  expect(result).toMatchObject({
    ok: false,
    result: null,
    error: expect.stringContaining("Could not store execution result"),
  });
  expect(JSON.stringify(result)).not.toContain("private-marker");
  await expect(data.list()).resolves.toEqual([]);
});
