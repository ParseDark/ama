import { it, expect } from "vitest";
import {
  planMemories,
  splitMemoryBlocks,
  estimateTokens,
} from "@/lib/memory/selector";
import { memory } from "./helpers";
it("filters expired, disabled, suggested and wrong scope; preferences first", () => {
  const ms = [
    memory("p", "Use bullets"),
    memory("r", "Jira board", { category: "reference", topic: "Sprint" }),
    memory("s", "Site", { scope: "domain:other.com" }),
    memory("x", "Expired", { expiresAt: 1 }),
    memory("d", "Disabled", { disabled: true }),
    memory("u", "Unconfirmed", { status: "suggested" }),
  ];
  expect(
    planMemories(ms, { relevantIds: new Set(["r"]) }).injected.map((m) => m.id),
  ).toEqual(["p", "r"]);
  const fallback = planMemories(ms);
  expect(fallback.injected.map((m) => m.id)).toEqual(["p"]);
  expect(splitMemoryBlocks(fallback).references).toContain("Sprint");
});
it("bounds the final reference catalogue with embeddings off or on", () => {
  const ms = Array.from({ length: 100 }, (_, i) =>
    memory(`r${i}`, "Fact ".repeat(30), {
      category: "reference",
      topic: `Topic ${i} ${"x".repeat(48)}`,
    }),
  );
  for (const relevantIds of [null, new Set(ms.map((m) => m.id))]) {
    const plan = planMemories(ms, { relevantIds });
    const blocks = splitMemoryBlocks(plan);
    expect(
      estimateTokens(blocks.preferences + "\n" + blocks.references),
    ).toBeLessThanOrEqual(450);
    expect(blocks.references).toContain("recall_memory");
  }
});
it("honors budget and decays inferred habits", () => {
  const ms = [
    memory("old", "Old inferred", {
      kind: "inferred",
      confidence: 0.5,
      lastSeen: 1,
    }),
    ...Array.from({ length: 30 }, (_, i) => memory(String(i), "A".repeat(100))),
  ];
  const p = planMemories(ms);
  expect(p.injected.some((m) => m.id === "old")).toBe(false);
  expect(p.injected.length).toBeLessThan(30);
  const b = splitMemoryBlocks(p);
  expect(estimateTokens(b.preferences + b.references)).toBeLessThanOrEqual(450);
});
