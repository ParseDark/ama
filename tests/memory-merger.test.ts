import { it, expect } from "vitest";
import {
  EVIDENCE_NEEDED,
  applyMemoryOps,
  isReadyToSuggest,
} from "@/lib/memory/merger";
import { memory } from "./helpers";
import { confirmSuggestion } from "@/lib/memory/store";
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
