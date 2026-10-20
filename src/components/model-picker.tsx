import { useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  getModelGroups,
  PROVIDERS,
  selectModel,
  type ProviderId,
  type Settings,
} from "@/lib/settings";
import { buttonVariants } from "./ui/button";

export function pickerGroups(settings: Settings, provider?: ProviderId) {
  const current = provider ?? settings.provider;
  const group = {
    provider: current,
    label: PROVIDERS[current],
    models: [
      ...new Set([
        settings.providers[current].model,
        ...(settings.providers[current].models ?? []),
      ]),
    ].filter(Boolean),
  };
  if (provider) return [group];
  const groups = getModelGroups(settings);
  return groups.some((g) => g.provider === current)
    ? groups
    : [...groups, group];
}

/** One picker for provider settings and the composer; provider scopes only the
 * available groups. Custom IDs are explicitly selected, never saved on typing. */
export function ModelPicker({
  settings,
  onChange,
  provider,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  provider?: ProviderId;
}) {
  const [query, setQuery] = useState("");
  const current = provider ?? settings.provider;
  const groups = pickerGroups(settings, provider);
  const search = query.trim();
  const filtered = groups
    .map((g) => ({
      ...g,
      models: g.models.filter((m) =>
        m.toLowerCase().includes(search.toLowerCase()),
      ),
    }))
    .filter((g) => g.models.length);
  const custom =
    search &&
    !groups.some((g) => g.provider === current && g.models.includes(search));
  return (
    <Combobox.Root
      value={`${current}|${settings.providers[current].model}`}
      inputValue={query}
      onInputValueChange={setQuery}
      filter={null}
      onOpenChange={() => setQuery("")}
      onValueChange={(v) => {
        if (v) {
          const [p, ...m] = String(v).split("|");
          onChange(selectModel(settings, p as ProviderId, m.join("|")));
        }
      }}
    >
      <Combobox.Trigger
        className={`${buttonVariants({ variant: "outline", size: "sm" })} model-trigger${provider ? " model-trigger-field" : ""}`}
        aria-label="Choose model"
      >
        <span>{settings.providers[current].model || "Choose model…"}</span>
        <ChevronsUpDown size={14} />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner side={provider ? "bottom" : "top"} sideOffset={8}>
          <Combobox.Popup className="model-popup">
            <Combobox.Input
              aria-label="Search models"
              placeholder="Search or enter a model ID…"
              autoComplete="off"
            />
            <Combobox.List>
              {filtered.map((g) => (
                <Combobox.Group key={g.provider}>
                  <Combobox.GroupLabel>{g.label}</Combobox.GroupLabel>
                  {g.models.map((m) => (
                    <Combobox.Item key={m} value={`${g.provider}|${m}`}>
                      <span>{m}</span>
                      <Combobox.ItemIndicator>
                        <Check size={14} />
                      </Combobox.ItemIndicator>
                    </Combobox.Item>
                  ))}
                </Combobox.Group>
              ))}
              {custom && (
                <Combobox.Item value={`${current}|${search}`}>
                  <span>Use “{search}”</span>
                  <span className="hint">{PROVIDERS[current]} · Custom ID</span>
                </Combobox.Item>
              )}
              {!filtered.length && !custom && (
                <div className="hint model-empty">
                  No models available. Fetch models or enter an ID.
                </div>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
