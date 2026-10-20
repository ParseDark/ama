import { it, expect, vi } from "vitest";
import { mergeSplitUsage } from "@/lib/usage-fetch";

const sse = (lines: string[]) =>
  new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/event-stream" },
  });

it("merges split usage chunks so the last chunk carries the prompt tokens", async () => {
  const fetchFn = vi.fn(async () =>
    sse([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":13,"completion_tokens":4}}',
      'data: {"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":14}}',
      "data: [DONE]",
      "",
    ]),
  );
  const text = await (
    await mergeSplitUsage(fetchFn as any)("http://gateway/chat", {})
  ).text();
  const chunks = text
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  expect(chunks.at(-1).usage).toEqual({
    prompt_tokens: 13,
    completion_tokens: 14,
    total_tokens: 27,
  });
  expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  expect(fetchFn).toHaveBeenCalledOnce();
});

it("leaves JSON responses untouched", async () => {
  const response = Response.json({ ok: true });
  const result = await mergeSplitUsage((async () => response) as any)(
    "http://gateway/models",
    {},
  );
  expect(result).toBe(response);
});
