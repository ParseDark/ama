import type { LanguageModelUsage, TextStreamPart, ToolSet } from "ai";

/** Local request timings, not provider-side inference benchmarks. */
export interface GenerationStats {
  version: 1;
  requests: number;
  firstTokenMs: number | null;
  totalMs: number;
  generationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  tokensPerSecond: number | null;
  status: "streaming" | "complete" | "stopped" | "error";
  usageComplete: boolean;
}

const count = (n: number | undefined): number | null =>
  n !== undefined && Number.isFinite(n) && n >= 0 ? n : null;
const add = (a: number | null, b: number | null) =>
  a === null || b === null ? null : a + b;

export class GenerationTracker {
  private started: number;
  private first: number | null = null;
  private generationMs = 0;
  private input: number | null = 0;
  private output: number | null = 0;
  private steps = 0;
  private timedOutput: number | null = 0;
  private status: GenerationStats["status"] = "streaming";
  private usageComplete = false;

  constructor(
    private now = () => performance.now(),
    private previous?: GenerationStats,
  ) {
    this.started = now();
  }

  /** Returns snapshots only at meaningful points, never per-token UI updates. */
  observe(part: TextStreamPart<ToolSet>): GenerationStats | undefined {
    let changed = false;
    if (
      this.first === null &&
      ((part.type === "text-delta" && part.text.length > 0) ||
        (part.type === "reasoning-delta" && part.text.length > 0) ||
        (part.type === "tool-input-delta" && part.delta.length > 0) ||
        part.type === "tool-call" ||
        part.type === "file" ||
        part.type === "reasoning-file")
    ) {
      this.first = Math.max(0, this.now() - this.started);
      changed = true;
    }
    if (part.type === "finish-step") {
      this.steps++;
      this.recordUsage(part.usage);
      const first = part.performance.timeToFirstOutputMs;
      const duration = part.performance.responseTimeMs - (first ?? NaN);
      const tokens = count(part.usage.outputTokens);
      if (Number.isFinite(duration) && duration > 0 && tokens !== null) {
        this.generationMs += duration;
        this.timedOutput = add(this.timedOutput, tokens);
      } else {
        // Never calculate throughput from missing usage or zero-length streams.
        this.timedOutput = null;
      }
      changed = true;
    }
    if (part.type === "finish") {
      if (!this.steps) {
        this.input = count(part.totalUsage.inputTokens);
        this.output = count(part.totalUsage.outputTokens);
      }
      if (this.status === "streaming") this.status = "complete";
      this.usageComplete = this.status === "complete";
      changed = true;
    }
    if (part.type === "abort" || part.type === "error") {
      this.status = part.type === "abort" ? "stopped" : "error";
      this.usageComplete = false;
      changed = true;
    }
    return part.type === "start" || changed ? this.snapshot() : undefined;
  }

  private recordUsage(usage: LanguageModelUsage) {
    this.input = add(this.input, count(usage.inputTokens));
    this.output = add(this.output, count(usage.outputTokens));
  }

  snapshot(): GenerationStats {
    const p = this.previous;
    const input = this.steps || this.usageComplete ? this.input : null;
    const output = this.steps || this.usageComplete ? this.output : null;
    const generationMs = (p?.generationMs ?? 0) + this.generationMs;
    const outputTokens = p ? add(p.outputTokens, output) : output;
    const timingComplete =
      this.timedOutput !== null &&
      this.usageComplete &&
      (!p || (p.tokensPerSecond !== null && p.usageComplete));
    return {
      version: 1,
      requests: (p?.requests ?? 0) + 1,
      firstTokenMs:
        p?.firstTokenMs ??
        (this.first === null ? null : (p?.totalMs ?? 0) + this.first),
      totalMs: (p?.totalMs ?? 0) + Math.max(0, this.now() - this.started),
      generationMs,
      inputTokens: p ? add(p.inputTokens, input) : input,
      outputTokens,
      tokensPerSecond:
        timingComplete &&
        generationMs > 0 &&
        outputTokens !== null &&
        (this.steps > 0 || !!p)
          ? outputTokens / (generationMs / 1000)
          : null,
      status: this.status,
      usageComplete: this.usageComplete && (!p || p.usageComplete),
    };
  }
}

export const formatDuration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
