import { it, expect } from "vitest";
import { saveSession, loadSession } from "@/lib/sessions";
import { GenerationTracker } from "@/lib/generation-stats";
it("persists timing metadata with history without changing message text", async () => {
  const stats = new GenerationTracker(() => 0).snapshot();
  await saveSession("timings", [
    { id: "u", role: "user", parts: [{ type: "text", text: "Question" }] },
    {
      id: "a",
      role: "assistant",
      parts: [{ type: "text", text: "Answer" }],
      metadata: { generationStats: stats },
    },
  ]);
  expect((await loadSession("timings"))[1].metadata).toEqual({
    generationStats: stats,
  });
});
