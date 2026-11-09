import { it, expect } from "vitest";
import { extractMemoryOps } from "@/lib/memory/extractor";
import { sourcedSignal } from "@/lib/memory/provenance";
import { jsonModel, failedModel } from "./helpers";
it("extracts sourced ops and never treats a bad answer as an empty result", async () => {
  const signal = sourcedSignal("s", "u", "user_msg", "Use bullets");
  const op = {
    op: "add",
    text: "Prefers bullet points",
    reason: "Repeated",
    sourceIds: [signal.source!.id],
  };
  const expected = [{ ...op, sources: [signal.source] }];
  expect(
    await extractMemoryOps([], [signal], [jsonModel({ ops: [op] })]),
  ).toEqual(expected);
  const fallback = jsonModel({ ops: [op] });
  expect(
    await extractMemoryOps([], [signal], [jsonModel("bad"), fallback]),
  ).toEqual(expected);
  expect(fallback.doGenerateCalls).toHaveLength(1);
  expect(await extractMemoryOps([], [], [jsonModel("bad")])).toBeNull();
  expect(await extractMemoryOps([], [], [failedModel()])).toBeNull();
  expect(
    await extractMemoryOps(
      [],
      [signal],
      [jsonModel({ ops: [{ ...op, sourceIds: ["invented"] }] })],
    ),
  ).toBeNull();
  expect(
    await extractMemoryOps(
      [],
      [signal],
      [
        jsonModel({
          ops: [{ op: "add", text: "Unsupported", reason: "Guess" }],
        }),
      ],
    ),
  ).toBeNull();
});
