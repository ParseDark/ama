import { it, expect } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import {
  StructuredOutputError,
  generateStructured,
} from "@/lib/llm-structured";
import { structuredModel } from "./structured-model";

const schema = z.object({ ok: z.boolean() });

it("forces the answer tool and returns its parsed arguments", async () => {
  const { model } = structuredModel({ ok: true });
  expect(
    await generateStructured({
      model,
      instructions: "Answer.",
      prompt: "Hello",
      schema,
    }),
  ).toEqual({ ok: true });
  const call: any = model.doGenerateCalls[0];
  expect(call.toolChoice).toEqual({ type: "tool", toolName: "answer" });
  expect(call.tools[0]).toMatchObject({
    type: "function",
    name: "answer",
    description: "Give your answer.",
  });
  expect(call.tools[0].inputSchema).toMatchObject({
    type: "object",
    properties: { ok: { type: "boolean" } },
  });
});

it("rejects answers that do not match the schema", async () => {
  const { model } = structuredModel({ ok: "yes" });
  await expect(
    generateStructured({
      model,
      instructions: "Answer.",
      prompt: "Hello",
      schema,
    }),
  ).rejects.toBeInstanceOf(StructuredOutputError);
});

it("rejects a plain-text reply, including fenced JSON", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: "text" as const,
          text: '```json\n{"ops":[{"op":"add","memory":"x"}]}\n```',
        },
      ],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  await expect(
    generateStructured({
      model,
      instructions: "Answer.",
      prompt: "Hello",
      schema,
    }),
  ).rejects.toBeInstanceOf(StructuredOutputError);
});
