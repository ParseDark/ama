import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { UIMessage } from "ai";
import type { Settings, ModelInfo, ModelPricing } from "@/lib/settings";
import {
  formatCost,
  formatTokens,
  meterLevel,
  replyCost,
  type MeterLevel,
} from "@/lib/context-usage";
import type { ContextPart } from "@/lib/context-breakdown";
import type { ReplyUsage } from "@/lib/local-chat-transport";
import { catalogModelInfo } from "@/lib/model-catalog";

const C = 2 * Math.PI * 6;

/** Ring order, labels and Tailwind colours (stroke via text-*, swatch via bg-*). */
export const BREAKDOWN_PARTS: {
  part: ContextPart;
  label: string;
  color: string;
  dot: string;
}[] = [
  {
    part: "system",
    label: "System prompt",
    color: "text-slate-400",
    dot: "bg-slate-400",
  },
  {
    part: "tools",
    label: "Tool definitions",
    color: "text-violet-500",
    dot: "bg-violet-500",
  },
  {
    part: "page",
    label: "Page content",
    color: "text-sky-500",
    dot: "bg-sky-500",
  },
  {
    part: "memory",
    label: "Memory",
    color: "text-fuchsia-500",
    dot: "bg-fuchsia-500",
  },
  {
    part: "conversation",
    label: "Earlier messages",
    color: "text-emerald-500",
    dot: "bg-emerald-500",
  },
  {
    part: "run",
    label: "This reply's tool steps",
    color: "text-orange-500",
    dot: "bg-orange-500",
  },
  {
    part: "output",
    label: "Reply",
    color: "text-amber-400",
    dot: "bg-amber-400",
  },
];

export interface RingSegment {
  part: string;
  tokens: number;
  color: string;
}

export function Ring({
  segments,
  whole,
  className = "size-4",
  thickness = 3,
  children,
}: {
  segments: RingSegment[];
  whole: number;
  className?: string;
  thickness?: number;
  children?: React.ReactNode;
}) {
  const visible = segments.filter((s) => s.tokens > 0);
  let offset = 0;
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        data-segments={visible.length}
        className="size-full -rotate-90"
      >
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          opacity={0.15}
        />
        {visible.map((segment) => {
          const length = Math.min(1, segment.tokens / Math.max(1, whole)) * C,
            circle = (
              <circle
                key={segment.part}
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke="currentColor"
                strokeWidth={thickness}
                strokeDasharray={`${length} ${C}`}
                strokeDashoffset={-offset}
                className={segment.color}
              />
            );
          offset += length;
          return circle;
        })}
      </svg>
      {children}
    </span>
  );
}

const levelClass = (level: MeterLevel) =>
  level === "full"
    ? "text-destructive"
    : level === "warn"
      ? "text-amber-600"
      : "text-muted-foreground";

const percentOf = (tokens: number, whole: number) => {
  const ratio = whole > 0 ? tokens / whole : 0;
  if (ratio > 0 && ratio < 0.01) return "<1%";
  return `${Math.round(ratio * 100)}%`;
};

function BreakdownPopup({
  usage,
  info,
  infoFetched,
  limit,
  level,
}: {
  usage: ReplyUsage;
  info?: ModelInfo;
  infoFetched?: boolean;
  limit?: number;
  level: MeterLevel;
}) {
  const breakdown = usage.breakdown,
    segments = breakdown
      ? BREAKDOWN_PARTS.map((p) => ({
          ...p,
          tokens: breakdown[p.part] ?? 0,
        })).filter((p) => p.tokens > 0)
      : [
          {
            part: "output",
            label: "Reply",
            color: "text-current",
            dot: "bg-current",
            tokens: usage.contextTokens,
          },
        ],
    whole = limit ?? usage.contextTokens,
    pricing: ModelPricing | undefined = info?.pricing,
    ratio = limit ? usage.contextTokens / limit : undefined;
  return (
    <div className="flex items-start gap-3 p-3" style={{ maxWidth: 320 }}>
      <div className="flex flex-col items-center gap-1">
        <Ring
          segments={segments.map((s) => ({
            part: s.part,
            tokens: s.tokens,
            color: s.color,
          }))}
          whole={whole}
          className="size-20"
          thickness={2.5}
        >
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium tabular-nums">
            {limit
              ? percentOf(usage.contextTokens, whole)
              : formatTokens(usage.contextTokens)}
          </span>
        </Ring>
        <span className="text-[10px] tabular-nums">
          {limit
            ? `${formatTokens(usage.contextTokens)} / ${formatTokens(limit)}`
            : `${formatTokens(usage.contextTokens)} tokens`}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 font-medium tabular-nums">
          {limit
            ? `${usage.contextTokens.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} tokens`
            : `${usage.contextTokens.toLocaleString("en-US")} tokens`}
        </div>
        <ul aria-label="Context breakdown" className="space-y-0.5">
          {segments.map((segment) => (
            <li key={segment.part} className="flex items-center gap-1.5">
              <span
                className={`size-1.5 shrink-0 rounded-full ${segment.dot}`}
              />
              <span className="min-w-0 flex-1 truncate">{segment.label}</span>
              <span className="tabular-nums">
                {formatTokens(segment.tokens)}
              </span>
              <span className="w-8 text-right tabular-nums text-[10px] opacity-70">
                {percentOf(segment.tokens, whole)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-white/15 pt-1 text-[10px] tabular-nums opacity-80">
          Last step: {formatTokens(usage.inputTokens)} in
          {usage.cachedInputTokens > 0
            ? ` (${formatTokens(usage.cachedInputTokens)} cached)`
            : ""}{" "}
          · {formatTokens(usage.outputTokens)} out
        </div>
        {pricing && (
          <div className="text-[10px] tabular-nums">
            Cost of this reply:{" "}
            {formatCost(replyCost(usage.total, usage.inputTokens, pricing))}
          </div>
        )}
        {info?.source === "models.dev" && (
          <div className="mt-1 text-[10px] text-amber-300">
            Limit from the models.dev catalog; your gateway may be lower.
          </div>
        )}
        {!limit && (
          <div className="mt-1 text-[10px] opacity-80">
            {infoFetched
              ? "No context limit was returned for this model."
              : "Fetch models in Settings to see the limit."}
          </div>
        )}
        <div className="mt-1 text-[10px] opacity-70">
          Totals come from the provider; the split of the prompt by source is
          estimated.
        </div>
        {level !== "ok" && (
          <div className="mt-1 text-[10px] text-amber-300">
            Getting full: clear the chat (⌥⇧L) to start fresh.
          </div>
        )}
      </div>
    </div>
  );
}

export function lastUsage(messages: UIMessage[]): ReplyUsage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = (messages[i].metadata as { usage?: ReplyUsage } | undefined)
      ?.usage;
    if (usage) return usage;
  }
  return undefined;
}

export function currentModelInfo(settings: Settings): ModelInfo | undefined {
  const config = settings.providers[settings.provider];
  if (!config) return undefined;
  return (
    config.modelInfo?.[config.model] ??
    catalogModelInfo(settings.provider, config.model, config.baseURL)
  );
}

export function ContextMeter({
  usage,
  info,
  infoFetched = false,
}: {
  usage?: ReplyUsage;
  info?: ModelInfo;
  infoFetched?: boolean;
}) {
  if (!usage) return null;
  const limit = info?.maxInputTokens,
    label = limit
      ? `${formatTokens(usage.contextTokens)} / ${formatTokens(limit)}`
      : `${formatTokens(usage.contextTokens)} tokens`,
    level = meterLevel(limit ? usage.contextTokens / limit : undefined),
    breakdown = usage.breakdown,
    segments = breakdown
      ? BREAKDOWN_PARTS.map((p) => ({
          ...p,
          tokens: breakdown[p.part] ?? 0,
        })).filter((p) => p.tokens > 0)
      : [
          {
            part: "output",
            label: "Reply",
            color: "text-current",
            dot: "bg-current",
            tokens: usage.contextTokens,
          },
        ],
    whole = limit ?? usage.contextTokens;
  return (
    <BaseTooltip.Provider delay={120} closeDelay={80}>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger
          render={
            <span
              role="status"
              aria-label={`Context window: ${label}`}
              className={`context-meter inline-flex items-center gap-1 text-[11px] tabular-nums ${levelClass(level)}`}
            />
          }
        >
          <Ring
            segments={segments.map((s) => ({
              part: s.part,
              tokens: s.tokens,
              color: s.color,
            }))}
            whole={whole}
          />
          <span>{label}</span>
        </BaseTooltip.Trigger>
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner side="top" sideOffset={6}>
            <BaseTooltip.Popup
              role="tooltip"
              className="tooltip context-popup w-80"
            >
              <BreakdownPopup
                usage={usage}
                info={info}
                infoFetched={infoFetched}
                limit={limit}
                level={level}
              />
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
