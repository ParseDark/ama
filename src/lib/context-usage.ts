import type { ModelPricing, TokenPrices } from "./settings";

/** 950 → "950", 12345 → "12.3k", 100000 → "100k", 1048576 → "1M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  const unit = n >= 1_000_000 ? 1_000_000 : 1000,
    scaled = n / unit;
  return `${Number(scaled.toFixed(scaled < 100 ? 1 : 0))}${unit === 1_000_000 ? "M" : "k"}`;
}

export type MeterLevel = "ok" | "warn" | "full";

/** Ratio of the model's input window already used. Unknown stays neutral. */
export function meterLevel(ratio?: number): MeterLevel {
  if (ratio === undefined || !Number.isFinite(ratio)) return "ok";
  if (ratio > 0.95) return "full";
  if (ratio > 0.8) return "warn";
  return "ok";
}

export interface CostUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
}

function pricesFor(pricing: ModelPricing, largestInput: number): TokenPrices {
  return pricing.threshold !== undefined &&
    pricing.long &&
    largestInput > pricing.threshold
    ? pricing.long
    : pricing;
}

/** USD cost of one reply. `largestInput` selects the long-context tier. */
export function replyCost(
  total: CostUsage,
  largestInput: number,
  pricing: ModelPricing,
): number {
  const p = pricesFor(pricing, largestInput),
    uncached = Math.max(
      0,
      total.inputTokens - total.cachedInputTokens - total.cacheWriteTokens,
    );
  return (
    (uncached * p.input +
      total.cachedInputTokens * (p.cacheRead ?? p.input) +
      total.cacheWriteTokens * (p.cacheWrite ?? p.input) +
      total.outputTokens * p.output) /
    1e6
  );
}

/** 0.000165 → "$0.0002"; 0.0123 → "$0.01". */
export function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}
