import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDataActions } from "@/lib/data/actions";
import { clearDataStore } from "@/lib/data/store";
import { createFileTools } from "@/lib/files/tools";
import type { FileWorkspace } from "@/lib/files/workspace";
import { createCodeTools } from "@/lib/code-tools";

beforeEach(async () => {
  await clearDataStore();
});

it("passes the full original file into run_js by ID, not the model excerpt", async () => {
  const text = Array.from({ length: 1000 }, (_, n) => `row-${n},${n}`).join(
    "\n",
  );
  const workspace = {
    read: vi.fn(async () => ({ text })),
  } as unknown as FileWorkspace;
  const data = createDataActions({ sessionId: "pipeline" });
  const read = createFileTools(workspace, data).read_file;
  const input = (read.inputSchema as z.ZodType).parse({
    path: "rows.csv",
    limit: 2,
  });
  const file = (await read.execute!(
    input as any,
    { toolCallId: "read-1" } as any,
  )) as any;
  expect(file.content).toBe("row-0,0\nrow-1,1");
  expect(file.truncated).toBe(true);
  expect(file.data.source).toBe("read_file");
  expect(await data.load(file.data.dataId)).toBe(text);
  const execute = vi.fn(async (_code, input) => ({
    id: "run",
    ok: true,
    result: input.data.csv.split("\n").at(-1),
    logs: [],
    error: null,
  }));
  const result = (await createCodeTools(data, execute).run_js.execute!(
    { code: "code", data: { csv: file.data.dataId }, params: {} },
    { toolCallId: "js-1" } as any,
  )) as any;
  expect(execute).toHaveBeenCalledWith("code", {
    data: { csv: text },
    params: {},
  });
  expect(await data.load(result.result.dataId)).toBe("row-999,999");
});

it("keeps ordinary reads working when storing the full file fails", async () => {
  const workspace = {
    read: vi.fn(async () => ({ text: "line\n".repeat(200) })),
  } as unknown as FileWorkspace;
  const data = createDataActions({
    sessionId: "pipeline",
    limits: { maxEntryBytes: 10 },
  });
  const read = createFileTools(workspace, data).read_file;
  const input = (read.inputSchema as z.ZodType).parse({
    path: "big.txt",
    limit: 1,
  });
  const file = (await read.execute!(
    input as any,
    { toolCallId: "read-3" } as any,
  )) as any;
  expect(file.content).toBe("line");
  expect(file.data).toBeUndefined();
  expect(file.dataWarning).toContain("not stored");
  await expect(data.list()).resolves.toEqual([]);
});

it("supports store-only file reads without leaking full content or invalid references", async () => {
  const text = "a".repeat(30000) + "private-tail-marker";
  const workspace = {
    read: vi.fn(async () => ({ text })),
  } as unknown as FileWorkspace;
  const data = createDataActions({ sessionId: "pipeline" });
  const read = createFileTools(workspace, data).read_file;
  const input = (read.inputSchema as z.ZodType).parse({
    path: "big.txt",
    storeOnly: true,
  });
  const file = (await read.execute!(
    input as any,
    { toolCallId: "read-2" } as any,
  )) as any;
  expect(file.content).toBeUndefined();
  expect(JSON.stringify(file)).not.toContain("private-tail-marker");
  expect(await data.load(file.data.dataId)).toBe(text);
  const foreign = createDataActions({ sessionId: "foreign" });
  await expect(foreign.load(file.data.dataId)).rejects.toThrow();
});
