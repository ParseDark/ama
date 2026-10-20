import { it, expect } from "vitest";
import { heuristicCategory } from "@/lib/memory/classify";
it("recognizes references and preference fallback", () => {
  expect(heuristicCategory("Jira https://example.com")).toBe("reference");
  expect(heuristicCategory("ticket ABC-123")).toBe("reference");
  expect(heuristicCategory("Use concise bullet points")).toBe("preference");
});
