import { MockLanguageModelV4 } from "ai/test";
import type { Memory } from "@/lib/memory/types";
import { structuredModel } from "./structured-model";
export const memory = (
  id: string,
  text: string,
  patch: Partial<Memory> = {},
): Memory => ({
  id,
  text,
  scope: "global",
  kind: "explicit",
  evidence: 1,
  confidence: 1,
  lastSeen: Date.now(),
  createdAt: Date.now(),
  ...patch,
});
/** Judge answer through the forced `answer` tool call. */
export const jsonModel = (data: unknown) => structuredModel(data).model;
export const failedModel = () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("Unavailable");
    },
  });
