import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationTracker, formatDuration } from "@/lib/generation-stats";
import { GenerationStatsView } from "@/components/generation-stats";

const step = (
  input: number | undefined = 100,
  output: number | undefined = 20,
  duration = 500,
  first = 100,
): any => ({
  type: "finish-step",
  usage: { inputTokens: input, outputTokens: output },
  performance: { responseTimeMs: duration, timeToFirstOutputMs: first },
});
const finish: any = {
  type: "finish",
  totalUsage: { inputTokens: 100, outputTokens: 20 },
};

it("measures first nonempty output from send including preparation and sums model-only streaming time", () => {
  let now = 0;
  const t = new GenerationTracker(() => now);
  t.observe({ type: "start" });
  now = 200;
  expect(t.observe({ type: "text-delta", id: "t", text: "" })).toBeUndefined();
  now = 400;
  expect(
    t.observe({ type: "reasoning-delta", id: "r", text: "Think" })
      ?.firstTokenMs,
  ).toBe(400);
  now = 500;
  t.observe({ type: "text-delta", id: "t", text: "Hi" });
  t.observe(step());
  now = 3000; // Includes tool execution, excluded from throughput denominator.
  t.observe(step(50, 30, 700, 100));
  const stats = t.observe(finish)!;
  expect(stats).toMatchObject({
    firstTokenMs: 400,
    totalMs: 3000,
    generationMs: 1000,
    inputTokens: 150,
    outputTokens: 50,
    tokensPerSecond: 50,
    status: "complete",
    usageComplete: true,
  });
});

it("does not estimate missing usage or infinite throughput for buffered output", () => {
  const t = new GenerationTracker(() => 0);
  const s = step();
  s.usage = {};
  t.observe(s);
  expect(t.observe(finish)).toMatchObject({
    inputTokens: null,
    outputTokens: null,
    tokensPerSecond: null,
  });
  const buffered = new GenerationTracker(() => 0);
  buffered.observe(step(1, 1, 100, 100));
  expect(buffered.observe(finish)?.tokensPerSecond).toBeNull();
});

it("supports tool-only first output and no output at all", () => {
  let now = 0;
  const t = new GenerationTracker(() => now);
  now = 100;
  expect(
    t.observe({ type: "tool-input-delta", id: "x", delta: "{" })?.firstTokenMs,
  ).toBe(100);
  const empty = new GenerationTracker(() => now);
  expect(empty.observe(finish)?.firstTokenMs).toBeNull();
});

it("aggregates approval continuations without human waiting and keeps original TTFT", () => {
  let now = 0;
  const t = new GenerationTracker(() => now);
  now = 100;
  t.observe({ type: "text-delta", id: "t", text: "Hi" });
  t.observe(step());
  now = 1000;
  const previous = t.observe(finish)!;
  now = 100000;
  const resumed = new GenerationTracker(() => now, previous);
  now = 100500;
  resumed.observe(step(50, 10, 300, 100));
  const stats = resumed.observe(finish)!;
  expect(stats).toMatchObject({
    requests: 2,
    firstTokenMs: 100,
    totalMs: 1500,
    inputTokens: 150,
    outputTokens: 30,
    generationMs: 600,
    tokensPerSecond: 50,
  });
});

it("marks stopped/error usage as partial rather than claiming complete statistics", () => {
  for (const type of ["abort", "error"] as const) {
    const t = new GenerationTracker(() => 0);
    expect(t.observe({ type, error: new Error("test") } as any)).toMatchObject({
      status: type === "abort" ? "stopped" : "error",
      usageComplete: false,
      inputTokens: null,
      outputTokens: null,
      tokensPerSecond: null,
    });
    expect(t.observe(finish)?.usageComplete).toBe(false);
  }
});

it("renders unavailable/partial metrics and exposes token accounting without estimating", () => {
  const stats = new GenerationTracker(() => 0).snapshot();
  const html = renderToStaticMarkup(<GenerationStatsView stats={stats} />);
  expect(html).toContain("Generation statistics");
  expect(html).toContain("Speed —");
  expect(html).toContain("Partial / awaiting provider usage");
  expect(html).toContain("no character-based estimate");
  expect(formatDuration(230)).toBe("230 ms");
  expect(formatDuration(1250)).toBe("1.25 s");
});
