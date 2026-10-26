import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createCodeTools } from "@/lib/code-tools";

it("describes the module, npm, JSON, Worker, and timeout contract", () => {
  const { run_js } = createCodeTools();
  for (const text of [
    "export default async function(input)",
    "npm imports",
    "JSON",
    "Worker",
    "no DOM",
    "10-second",
  ])
    expect(run_js.description).toContain(text);
  expect(document.querySelector("iframe")).toBeNull();
});

it("validates JSON input and forwards code/input with the complete sandbox response", async () => {
  const response = {
    id: "run-1",
    ok: true,
    result: { sum: 3 },
    logs: ["computed"],
    error: null,
  };
  const execute = vi.fn(async () => response);
  const { run_js } = createCodeTools(execute);
  const schema = run_js.inputSchema as z.ZodType;
  const input = {
    code: "export default async function(input) { return input.a + input.b; }",
    input: { a: 1, b: 2 },
  };
  expect(schema.parse(input)).toEqual(input);
  expect(schema.safeParse({ code: 1, input: null }).success).toBe(false);
  expect(schema.safeParse({ code: "code", input: () => {} }).success).toBe(
    false,
  );
  expect(schema.safeParse({ code: "code", input: undefined }).success).toBe(
    false,
  );
  expect(await run_js.execute!(input, {} as any)).toEqual(response);
  expect(execute).toHaveBeenCalledWith(input.code, input.input);
});

it("preserves sandbox failures and propagates transport errors", async () => {
  const failure = {
    id: "run-2",
    ok: false,
    result: null,
    logs: ["before failure"],
    error: "boom",
  };
  const { run_js } = createCodeTools(vi.fn(async () => failure));
  expect(
    await run_js.execute!({ code: "code", input: null }, {} as any),
  ).toEqual(failure);
  const broken = createCodeTools(
    vi.fn(async () => {
      throw new Error("disposed");
    }),
  );
  await expect(
    broken.run_js.execute!({ code: "code", input: null }, {} as any),
  ).rejects.toThrow("disposed");
});
