import { it, expect } from "vitest";
import {
  EVIDENCE_NEEDED,
  applyMemoryOps,
  isReadyToSuggest,
} from "@/lib/memory/merger";
import { memory } from "./helpers";
import { confirmSuggestion } from "@/lib/memory/store";
import { sourcedSignal } from "@/lib/memory/provenance";
it("counts independent user messages once across replay and keeps provenance", () => {
  const a = sourcedSignal("s", "a", "user_msg", "Use bullets").source!;
  const b = sourcedSignal("s", "b", "user_msg", "Use bullets").source!;
  const op: any = {
    op: "add",
    text: "Prefers bullets",
    reason: "User evidence",
    sources: [a],
  };
  const first = applyMemoryOps([], [op], { newId: () => "m" });
  const replay = applyMemoryOps(first, [op, op]);
  expect(replay[0].evidence).toBe(1);
  expect(replay[0].sources).toEqual([a]);
  const next = applyMemoryOps(replay, [{ ...op, sources: [b] }]);
  expect(next[0].evidence).toBe(2);
  expect(next[0].sources).toEqual([a, b]);
  expect(next[0].changes?.map((c) => c.action)).toEqual(["add", "reinforce"]);
  const together = applyMemoryOps([], [{ ...op, sources: [a, b, b] }]);
  expect(together[0].evidence).toBe(2);
  const edited = sourcedSignal("s", "b", "user_msg", "Use bullets now").source!;
  expect(applyMemoryOps(next, [{ ...op, sources: [edited] }])[0].evidence).toBe(
    2,
  );
});
it("guards owned memories and sensitive text; learns suggestions not active memories", () => {
  const original = memory("a", "Owned");
  const result = applyMemoryOps(
    [original],
    [
      { op: "delete", id: "a", reason: "" },
      { op: "update", id: "a", text: "Changed", reason: "" },
      { op: "add", text: "password is secret", reason: "" },
      { op: "add", text: "Prefers bullets", reason: "" },
    ],
    { newId: () => "new" },
  );
  expect(result).toHaveLength(2);
  expect(result[0].text).toBe("Owned");
  expect(result[1]).toMatchObject({ status: "suggested", confidence: 0.5 });
  expect(EVIDENCE_NEEDED).toBe(2);
  expect(isReadyToSuggest(result[1])).toBe(false);
  const reinforced = applyMemoryOps(result, [
    { op: "reinforce", id: "new", reason: "" },
  ])[1];
  expect(isReadyToSuggest(reinforced)).toBe(true);
  expect(confirmSuggestion(reinforced)).toMatchObject({
    kind: "explicit",
    status: "active",
    confidence: 1,
  });
});
