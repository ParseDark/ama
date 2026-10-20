import { formatDuration, type GenerationStats } from "@/lib/generation-stats";

export function GenerationStatsView({ stats }: { stats: GenerationStats }) {
  return (
    <div
      className="generation-stats"
      aria-label="Generation statistics"
      title="Local timings. TTFT starts when sending (includes page/memory preparation) and ends at the first text, reasoning, or tool output chunk. Speed uses provider-reported output tokens, including reasoning/tool tokens, divided by model streaming time after first output; excludes tool execution and approval waiting. Total sums active requests, excluding human approval waiting. Not a server-side inference benchmark."
    >
      <span>
        TTFT{" "}
        {stats.firstTokenMs === null ? "—" : formatDuration(stats.firstTokenMs)}
      </span>
      <span>
        {stats.tokensPerSecond === null
          ? "Speed —"
          : `${stats.tokensPerSecond.toFixed(1)} tok/s`}
      </span>
      <span>Total {formatDuration(stats.totalMs)}</span>
      <details>
        <summary>Tokens</summary>
        <span>
          Input {stats.inputTokens ?? "—"} · Output {stats.outputTokens ?? "—"}
        </span>
        {!stats.usageComplete && <span>Partial / awaiting provider usage</span>}
        {(stats.inputTokens === null || stats.outputTokens === null) && (
          <span>Token counts unavailable; no character-based estimate.</span>
        )}
        <span>
          {stats.requests} request{stats.requests === 1 ? "" : "s"} ·{" "}
          {stats.status}
        </span>
      </details>
    </div>
  );
}
