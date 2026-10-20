import { it, expect } from "vitest";
import { extractMemoryOps } from "@/lib/memory/extractor";
import { jsonModel, failedModel } from "./helpers";
it("extracts valid ops and never treats a bad answer as an empty result", async () => {
  const op = { op: "add", text: "Prefers bullet points", reason: "Repeated" };
  expect(await extractMemoryOps([], [], [jsonModel({ ops: [op] })])).toEqual([
    op,
  ]);
  const fallback = jsonModel({ ops: [op] });
  expect(await extractMemoryOps([], [], [jsonModel("bad"), fallback])).toEqual([
    op,
  ]);
  expect(fallback.doGenerateCalls).toHaveLength(1);
  expect(await extractMemoryOps([], [], [jsonModel("bad")])).toBeNull();
  expect(await extractMemoryOps([], [], [failedModel()])).toBeNull();
});
