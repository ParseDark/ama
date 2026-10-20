import { it, expect } from "vitest";
import { judgeMemoryIntent } from "@/lib/memory/intent";
import { jsonModel, failedModel } from "./helpers";
it("true/false and only latest user data goes to judge", async () => {
  const model = jsonModel({ asksToRemember: true });
  expect(await judgeMemoryIntent("记住中文", [model])).toBe(true);
  expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("记住中文");
  expect(
    await judgeMemoryIntent("summarize", [
      jsonModel({ asksToRemember: false }),
    ]),
  ).toBe(false);
});
it("malformed terminates, unavailable model falls back", async () => {
  const fallback = jsonModel({ asksToRemember: true });
  expect(
    await judgeMemoryIntent("save", [jsonModel("bad json"), fallback]),
  ).toBeNull();
  expect(fallback.doGenerateCalls).toHaveLength(0);
  expect(await judgeMemoryIntent("save", [failedModel(), fallback])).toBe(true);
});
