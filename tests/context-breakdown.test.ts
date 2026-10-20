import { it, expect } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import {
  IMAGE_TOKENS,
  calibrate,
  estimatePrompt,
} from "@/lib/context-breakdown";

const tools = {
  echo: tool({
    description: "Echo text",
    inputSchema: z.object({ text: z.string() }),
  }),
};
const user = (parts: any[]) => ({
  id: "u",
  role: "user" as const,
  parts,
});

it("splits page and memory out of the instructions", async () => {
  const pageText = "p".repeat(400),
    memoryText = "m".repeat(1200),
    instructions = "s".repeat(80) + pageText + memoryText;
  const estimate = await estimatePrompt({
    instructions,
    pageText,
    memoryText,
    tools,
    messages: [],
  });
  expect(estimate).toMatchObject({ system: 20, page: 100, memory: 300 });
  expect(estimate.tools).toBeGreaterThan(0);
  expect(estimate.conversation).toBe(0);
});

it("counts text, images and tool parts as conversation", async () => {
  const estimate = await estimatePrompt({
    instructions: "instructions",
    pageText: "",
    memoryText: "",
    tools,
    messages: [
      user([
        { type: "text", text: "hello" },
        {
          type: "file",
          mediaType: "image/png",
          url: "data:image/png;base64,x",
        },
        {
          type: "tool-echo",
          toolCallId: "t1",
          state: "output-available",
          input: { text: "hi" },
          output: { ok: true },
        },
      ]),
    ],
  });
  expect(estimate.conversation).toBeGreaterThan(
    IMAGE_TOKENS + Math.ceil("hello".length / 4),
  );
});

it("calibrates prompt parts to the real first-step input", () => {
  const breakdown = calibrate(
    { system: 100, tools: 100, page: 600, memory: 100, conversation: 100 },
    { firstInput: 2001, lastInput: 2801, output: 50 },
  );
  expect(breakdown.page).toBe(1201);
  expect(
    breakdown.system +
      breakdown.tools +
      breakdown.page +
      breakdown.memory +
      breakdown.conversation,
  ).toBe(2001);
  expect(breakdown.run).toBe(800);
  expect(breakdown.output).toBe(50);
});

it("puts everything under system when there is nothing to scale", () => {
  const breakdown = calibrate(
    { system: 0, tools: 0, page: 0, memory: 0, conversation: 0 },
    { firstInput: 500, lastInput: 500, output: 0 },
  );
  expect(breakdown).toEqual({
    system: 500,
    tools: 0,
    page: 0,
    memory: 0,
    conversation: 0,
    run: 0,
    output: 0,
  });
});
