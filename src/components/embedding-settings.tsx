import { useState } from "react";
import { getEmbeddingConfig, type Settings } from "@/lib/settings";
import { embedTexts } from "@/lib/memory/embeddings";
import { Switch } from "./ui/switch";
import { Field } from "./ui/field";
import { Button } from "./ui/button";
export function EmbeddingSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const c = getEmbeddingConfig(settings),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const update = (patch: Partial<typeof c>) =>
    onChange({ ...settings, embedding: { ...c, ...patch } });
  return (
    <section>
      <div className="section-heading">
        <h2>Embeddings</h2>
        <Switch
          aria-label="Use embeddings"
          checked={c.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
        />
      </div>
      <p className="hint">
        Match by meaning: saved references only when a message is about them,
        similar memories, earlier chats and the most relevant MCP tools. Off:
        AMA matches keywords instead.
      </p>
      {c.enabled && (
        <>
          <Field
            label="Endpoint"
            hint="tools/embed-server runs on http://127.0.0.1:8765/v1. The gateway works too (model embedding-bge-m3)."
          >
            <input
              value={c.url}
              onChange={(e) => update({ url: e.target.value })}
            />
          </Field>
          <div className="columns">
            <Field label="Model">
              <input
                value={c.model}
                onChange={(e) => update({ model: e.target.value })}
              />
            </Field>
            <Field label="Token">
              <input
                type="password"
                value={c.token}
                onChange={(e) => update({ token: e.target.value })}
              />
            </Field>
          </div>
          <details>
            <summary>Advanced</summary>
            <Field label="Dimensions">
              <input
                type="number"
                min={32}
                max={4096}
                value={c.dimensions}
                onChange={(e) => update({ dimensions: Number(e.target.value) })}
              />
            </Field>
            <Field label="Min similarity">
              <input
                type="number"
                min={0}
                max={1}
                step="0.01"
                value={c.minScore}
                onChange={(e) => update({ minScore: Number(e.target.value) })}
              />
            </Field>
          </details>
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const start = performance.now();
              try {
                const [v] = await embedTexts(c, ["connection test"], "query", {
                  signal: AbortSignal.timeout(10000),
                });
                setStatus(
                  `Connected · ${v.length} dims · ${Math.round(performance.now() - start)} ms`,
                );
              } catch (e) {
                setStatus(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Testing…" : "Test connection"}
          </Button>
          <p role="status" className="hint">
            {status}
          </p>
        </>
      )}
    </section>
  );
}
