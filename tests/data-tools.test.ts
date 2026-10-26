import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { createDataActions } from "@/lib/data/actions";
import { clearDataStore } from "@/lib/data/store";
import { createDataTools } from "@/lib/data/tools";

beforeEach(clearDataStore);

it("exposes list_data and inspect_data as descriptor-only tools", async () => {
  const data = createDataActions({ sessionId: "tool-session" });
  const saved = await data.save([1, 2, 3], { source: "run_js" });
  const tools = createDataTools(data);
  expect(Object.keys(tools)).toEqual(["list_data", "inspect_data"]);
  const context = { toolCallId: "tool", messages: [], context: {} };
  const { preview: _preview, ...metadata } = saved;
  expect(await tools.list_data.execute!({}, context)).toEqual({
    items: [metadata],
    limit: 100,
    truncated: false,
  });
  const result = await tools.inspect_data.execute!(
    { dataId: saved.dataId, offset: 1, limit: 1 },
    context,
  );
  expect(result).toMatchObject({
    dataId: saved.dataId,
    preview: [2],
    previewTruncated: true,
  });
  expect(result).not.toHaveProperty("value");
  expect(result).not.toHaveProperty("sessionId");
  await expect(
    createDataTools(createDataActions({ sessionId: "different" })).inspect_data
      .execute!({ dataId: saved.dataId }, context),
  ).rejects.toThrow("unavailable");
});

it("requires dataId and strictly validates pagination and unknown parameters", () => {
  const tools = createDataTools(createDataActions({ sessionId: "a" }));
  const schema = tools.inspect_data.inputSchema as z.ZodType;
  expect(schema.safeParse({ dataId: "abc" }).success).toBe(true);
  expect(
    schema.safeParse({ dataId: "abc", offset: 0, limit: 1000 }).success,
  ).toBe(true);
  for (const input of [
    { id: "abc" },
    { dataId: "" },
    { dataId: "a".repeat(201) },
    { dataId: "a", offset: -1 },
    { dataId: "a", offset: 0.1 },
    { dataId: "a", limit: 0 },
    { dataId: "a", limit: 1001 },
    { dataId: "a", value: true },
  ]) {
    expect(schema.safeParse(input).success).toBe(false);
  }
  expect(
    (tools.list_data.inputSchema as z.ZodType).safeParse({ limit: 100 })
      .success,
  ).toBe(false);
});
