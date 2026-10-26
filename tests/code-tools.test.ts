import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { createCodeTools } from "@/lib/code-tools";
import { createDataActions } from "@/lib/data/actions";
import { clearDataStore, deleteSessionData } from "@/lib/data/store";

beforeEach(async () => {
  await clearDataStore();
});
const options = { toolCallId: "call-1" } as any;
const response = (result: unknown) => ({
  id: "run-1",
  ok: true,
  result,
  logs: ["computed"],
  error: null,
});
const data = () => createDataActions({ sessionId: "chat" });

it("describes stored references and the module/Worker contract", () => {
  const { run_js } = createCodeTools(data());
  for (const text of [
    "export default async function(input)",
    "npm imports",
    "JSON",
    "Worker",
    "no DOM",
    "10-second",
    "dataId",
    "Never copy datasets",
  ])
    expect(run_js.description).toContain(text);
  expect(document.querySelector("iframe")).toBeNull();
});

it("loads original data by ID and saves large output without returning it to the model", async () => {
  const actions = data();
  const original = Array.from({ length: 1000 }, (_, n) => ({
    n,
    label: `row-${n}`,
  }));
  const stored = await actions.save(original, { source: "test" });
  const execute = vi.fn(async () => response(original));
  const { run_js } = createCodeTools(actions, execute);
  const result = (await run_js.execute!(
    { code: "code", data: { rows: stored.dataId }, params: { min: 2 } },
    options,
  )) as any;
  expect(execute).toHaveBeenCalledExactlyOnceWith("code", {
    data: { rows: original },
    params: { min: 2 },
  });
  expect(result.ok).toBe(true);
  expect(result.result.dataId).not.toBe(stored.dataId);
  expect(result.result.previewTruncated).toBe(true);
  expect(JSON.stringify(result)).not.toContain('"row-999"');
  expect(await actions.load(result.result.dataId)).toEqual(original);
  const next = createCodeTools(actions, execute).run_js;
  await next.execute!(
    { code: "next", data: { previous: result.result.dataId } },
    options,
  );
  expect(execute).toHaveBeenLastCalledWith("next", {
    data: { previous: original },
    params: null,
  });
});

it("retains small legacy input but returns a stored result descriptor", async () => {
  const actions = data();
  const execute = vi.fn(async () => response(3));
  const { run_js } = createCodeTools(actions, execute);
  const result = (await run_js.execute!(
    { code: "code", input: { a: 1, b: 2 } },
    options,
  )) as any;
  expect(execute).toHaveBeenCalledWith("code", { a: 1, b: 2 });
  expect(await actions.load(result.result.dataId)).toBe(3);
});

it("validates exclusive input modes and limits inline data", () => {
  const schema = createCodeTools(data()).run_js.inputSchema as z.ZodType;
  expect(
    schema.safeParse({ code: "code", data: { rows: "data_a" }, params: {} })
      .success,
  ).toBe(true);
  expect(schema.safeParse({ code: "code", input: null }).success).toBe(true);
  for (const value of [
    { code: 1, input: null },
    { code: "code", input: () => {} },
    { code: "code", input: [], data: {} },
    { code: "code", input: {}, params: null },
    { code: "code", params: "a".repeat(5000) },
    { code: "code", input: "a".repeat(17000) },
    {
      code: "code",
      data: Object.fromEntries(
        Array.from({ length: 9 }, (_, n) => [String(n), "id"]),
      ),
    },
  ])
    expect(schema.safeParse(value).success).toBe(false);
});

it("never executes unknown, expired or foreign references", async () => {
  const actions = data();
  const foreign = await createDataActions({ sessionId: "other" }).save([1], {
    source: "test",
  });
  const execute = vi.fn();
  const run = createCodeTools(actions, execute).run_js;
  for (const id of ["missing", foreign.dataId])
    await expect(
      run.execute!({ code: "code", data: { rows: id } }, options),
    ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it("preserves execution errors and prevents storing results after chat deletion", async () => {
  const actions = data();
  const failure = {
    id: "run-2",
    ok: false,
    result: null,
    logs: ["before failure"],
    error: "boom",
  };
  expect(
    await createCodeTools(
      actions,
      vi.fn(async () => failure),
    ).run_js.execute!({ code: "code", input: null }, options),
  ).toMatchObject(failure);
  const run = createCodeTools(actions, async () => {
    await deleteSessionData("chat");
    return response([1, 2]);
  }).run_js;
  const result = (await run.execute!(
    { code: "code", input: null },
    options,
  )) as any;
  expect(result).toMatchObject({ ok: false, result: null });
  expect(result.error).toContain("Could not store");
});

it("bounds console output independently of stored data", async () => {
  const run = createCodeTools(data(), async () => ({
    ...response(1),
    logs: Array(100).fill("x".repeat(10000)),
  })).run_js;
  const result = (await run.execute!(
    { code: "code", input: null },
    options,
  )) as any;
  expect(result.logs.join("").length).toBeLessThanOrEqual(8192);
  expect(result.logsTruncated).toBe(true);
});

it("propagates transport errors and cancellation", async () => {
  const run = createCodeTools(data(), async () => {
    throw new Error("disposed");
  }).run_js;
  await expect(
    run.execute!({ code: "code", input: null }, options),
  ).rejects.toThrow("disposed");
  const execute = vi.fn();
  await expect(
    createCodeTools(data(), execute).run_js.execute!(
      { code: "code", input: null },
      { ...options, abortSignal: AbortSignal.abort() },
    ),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
