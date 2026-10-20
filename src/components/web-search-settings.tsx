import { useState } from "react";
import { getWebSearchConfig, type Settings } from "@/lib/settings";
import { DeepSeekWebClient } from "@/lib/web-search/client";
import { Switch } from "./ui/switch";
import { Field } from "./ui/field";
import { Button } from "./ui/button";

export function WebSearchSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const config = getWebSearchConfig(settings);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const update = (patch: Partial<typeof config>) => {
    setStatus("");
    onChange({ ...settings, webSearch: { ...config, ...patch } });
  };
  return (
    <section aria-label="Web search settings">
      <div className="section-heading">
        <h2>Web search</h2>
        <Switch
          aria-label="Use web search"
          checked={config.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
        />
      </div>
      <p className="hint">
        Optional DeepSeek Search &amp; Fetch, with any chat model. Off by
        default. Enabling allows automatic public web lookups: search queries
        and fetched URLs are sent to DeepSeek; results are sent to your current
        model. Browser login and cookies are not shared.
      </p>
      {config.enabled && (
        <>
          <Field
            label="DeepSeek search API key"
            hint="Use an official DeepSeek API key, not your chat gateway key. Stored locally without encryption; included if Chrome configuration sync is enabled."
          >
            <input
              type="password"
              aria-label="DeepSeek search API key"
              autoComplete="off"
              value={config.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder="Required"
            />
          </Field>
          {!config.apiKey.trim() && (
            <p className="hint" role="status">
              Add a DeepSeek key to make web tools available.
            </p>
          )}
          <p className="hint">
            Up to 3 searches and 3 page fetches per reply. Search returns 5
            results by default; pages are limited to 24,000 characters. Public
            URLs only; use browser tools for logged-in pages.
          </p>
          <p className="hint">
            DeepSeek currently lists $0.75 per 1,000 successful requests for
            each API, plus your chat model's token costs. Test search sends
            “DeepSeek” and may incur one request fee.
          </p>
          <Button
            variant="outline"
            disabled={busy || !config.apiKey.trim()}
            onClick={async () => {
              setBusy(true);
              setStatus("");
              try {
                const result = await new DeepSeekWebClient(config).search({
                  query: "DeepSeek",
                  count: 1,
                });
                setStatus(`Connected · ${result.results.length} results`);
              } catch (e) {
                setStatus(
                  e instanceof Error ? e.message : "Web search test failed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Testing…" : "Test search"}
          </Button>
          <p className="hint" role="status">
            {status}
          </p>
        </>
      )}
    </section>
  );
}
