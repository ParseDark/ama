import { useEffect, useState } from "react";
import type { Settings } from "@/lib/settings";
import { contextBudget } from "@/lib/compaction";
import { Switch } from "./ui/switch";

export function CompactSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const budget = contextBudget(settings);
  const [draft, setDraft] = useState(
    String(settings.compaction?.contextTokens ?? ""),
  );
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(String(settings.compaction?.contextTokens ?? ""));
  }, [settings.compaction?.contextTokens]);
  const saveOverride = () => {
    const value = draft.trim() === "" ? undefined : Number(draft);
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 4096 || value > 2000000)
    ) {
      setError(
        "Enter a whole number from 4,096 to 2,000,000, or leave blank for the detected limit.",
      );
      return;
    }
    setError("");
    onChange({
      ...settings,
      compaction: {
        enabled: settings.compaction?.enabled !== false,
        contextTokens: value,
      },
    });
  };
  return (
    <section>
      <div className="section-heading">
        <h2>Context compact</h2>
        <Switch
          aria-label="Automatic compact"
          checked={settings.compaction?.enabled !== false}
          onCheckedChange={(enabled) =>
            onChange({
              ...settings,
              compaction: { ...settings.compaction, enabled },
            })
          }
        />
      </div>
      <p className="hint">
        Automatically summarize older history near the working budget and thin
        older tool observations. Original chats are kept. Summaries use your
        selected chat model, may lose details and add latency/cost. Pending
        approvals and recent turns remain intact. Changes apply next request.
        Turn this off to disable automatic pruning/summarization; the budget
        safety check and explicit Compact remain available.
      </p>
      <label>
        Total context window override (tokens)
        <input
          aria-label="Context window override"
          type="number"
          min={4096}
          max={2000000}
          step={1024}
          placeholder="Use detected limit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveOverride}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveOverride();
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <p className="hint">
        The override applies to all chat models until cleared. Current working
        input budget: ~{budget.input.toLocaleString()} tokens; output reserved
        up to {budget.output.toLocaleString()}.{" "}
        {budget.fallback
          ? "Limit unknown: using a conservative 32k total fallback."
          : "Based on model metadata or your override; gateway limits may differ."}{" "}
        Counts are estimates, not the provider's tokenizer. This setting syncs
        with optional configuration sync; chat summaries stay local.
      </p>
    </section>
  );
}
