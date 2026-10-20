import { useRef, useState } from "react";
import {
  ArrowLeft,
  Pin,
  PinOff,
  Trash2,
  Eye,
  EyeOff,
  Download,
  Upload,
} from "lucide-react";
import { useLearningState, useMemory } from "@/hooks/use-memory";
import {
  setMemoryEnabled,
  updateMemories,
  removeMemory,
  exportMemories,
  importMemories,
  clearMemories,
  acceptSuggestion,
  dismissSuggestion,
} from "@/lib/memory/store";
import type { Memory } from "@/lib/memory/types";
import type { Settings } from "@/lib/settings";
import { getEmbeddingConfig } from "@/lib/settings";
import { EVIDENCE_NEEDED, isReadyToSuggest } from "@/lib/memory/merger";
import { formatRelativeTime } from "@/lib/time";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { SimilarMemories } from "./similar-memories";
import { MemorySuggestion } from "./memory-suggestion";
export function MemoryView({
  settings,
  onBack,
}: {
  settings: Settings;
  onBack: () => void;
}) {
  const { memories, enabled } = useMemory(),
    { lastRunAt } = useLearningState(),
    [scope, setScope] = useState("all"),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    file = useRef<HTMLInputElement>(null);
  const update = (id: string, patch: Partial<Memory>) =>
    void updateMemories((ms) =>
      ms.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  const active = memories.filter(
      (m) => m.status !== "dismissed" && m.status !== "suggested",
    ),
    scopes = [...new Set(active.map((m) => m.scope))],
    noticed = memories.filter(
      (m) => m.status === "suggested" && !m.disabled && !isReadyToSuggest(m),
    );
  return (
    <div className="view">
      <header>
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </Button>
        <h1>Memory</h1>
        <label className="row hint">
          Use memory <span>{enabled ? "On" : "Off"}</span>
          <Switch
            aria-label="Use memory"
            checked={enabled}
            onCheckedChange={(v) => void setMemoryEnabled(v)}
          />
        </label>
      </header>
      <div className="settings-body">
        <p className="hint">
          Preferences shape every reply. References are recalled when relevant.
          Only confirmed habits are used. Edit or remove anything, anytime.
          Explicit saves may include sensitive information. Memories stay in
          local storage without encryption; recalled text goes to your chat
          model, and semantic matching may send it to your configured embedding
          service.
        </p>
        <SimilarMemories
          memories={memories}
          config={getEmbeddingConfig(settings)}
        />
        {memories.some((m) => isReadyToSuggest(m)) && (
          <section>
            <h2>Suggestions learned from your chats</h2>
            {memories
              .filter((m) => isReadyToSuggest(m))
              .map((m) => (
                <MemorySuggestion key={m.id} memory={m} />
              ))}
          </section>
        )}
        {enabled && (
          <section aria-label="Noticed so far">
            <h2>Noticed so far</h2>
            <p className="hint">
              Learning from your chats:{" "}
              {lastRunAt
                ? `last ran ${formatRelativeTime(lastRunAt)}`
                : "hasn't run yet"}
              .
            </p>
            {noticed.length ? (
              <>
                <p className="hint">
                  Noticed so far (suggested after {EVIDENCE_NEEDED} sightings):
                </p>
                <ul className="memories">
                  {noticed.map((m) => (
                    <li key={m.id} className="memory-row">
                      <span>
                        {m.text}
                        {m.scope !== "global" ? ` · ${m.scope.slice(7)}` : ""}
                        {` · seen ${m.evidence} of ${EVIDENCE_NEEDED}`}
                      </span>
                      <div className="row">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void dismissSuggestion(m.id)}
                        >
                          No
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void acceptSuggestion(m.id)}
                        >
                          Remember
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="hint">Nothing new noticed.</p>
            )}
          </section>
        )}
        {scopes.length > 1 && (
          <div className="scope-filter">
            {["all", ...scopes].map((s) => (
              <Button
                key={s}
                variant={scope === s ? "default" : "ghost"}
                size="sm"
                onClick={() => setScope(s)}
              >
                {s === "all" ? "All" : s === "global" ? "Global" : s.slice(7)}
              </Button>
            ))}
          </div>
        )}
        {active.length ? (
          <ul aria-label="Memories" className="memories">
            {active
              .filter((m) => scope === "all" || m.scope === scope)
              .map((m) => (
                <li
                  key={m.id}
                  className={`memory-row ${m.disabled ? "disabled" : ""}`}
                >
                  <textarea
                    aria-label={`Edit memory ${m.text}`}
                    value={m.text}
                    onChange={(e) => update(m.id, { text: e.target.value })}
                  />
                  <div className="badges">
                    <button
                      className="badge"
                      onClick={() =>
                        update(m.id, {
                          category:
                            m.category === "reference"
                              ? "preference"
                              : "reference",
                        })
                      }
                    >
                      {m.category === "reference" ? "Reference" : "Preference"}
                    </button>
                    <span className="badge">
                      {m.scope === "global" ? "Global" : m.scope.slice(7)}
                    </span>
                    <span className="badge">{m.kind}</span>
                    {m.disabled && <span className="badge">Not used</span>}
                  </div>
                  {m.category === "reference" && (
                    <input
                      aria-label={`Topic for ${m.text}`}
                      placeholder="Topic"
                      value={m.topic ?? ""}
                      maxLength={60}
                      onChange={(e) => update(m.id, { topic: e.target.value })}
                    />
                  )}
                  <div className="row memory-actions">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={m.pinned ? "Unpin" : "Pin"}
                      onClick={() => update(m.id, { pinned: !m.pinned })}
                    >
                      {m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`${m.disabled ? "Use" : "Stop using"} "${m.text}"`}
                      onClick={() => update(m.id, { disabled: !m.disabled })}
                    >
                      {m.disabled ? <Eye size={14} /> : <EyeOff size={14} />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete "${m.text}"`}
                      onClick={() => void removeMemory(m.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        ) : (
          <div className="empty-small">Nothing remembered yet</div>
        )}
        <footer className="row">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const url = URL.createObjectURL(
                  new Blob([await exportMemories()], {
                    type: "application/json",
                  }),
                ),
                a = document.createElement("a");
              a.href = url;
              a.download = "ama-memory.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download size={14} />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => file.current?.click()}
          >
            <Upload size={14} />
            Import
          </Button>
          <input
            hidden
            type="file"
            ref={file}
            accept="application/json"
            onChange={async (e) => {
              try {
                const f = e.target.files?.[0];
                if (f) await importMemories(await f.text());
                setError("");
              } catch (e) {
                setError(String(e));
              }
              e.target.value = "";
            }}
          />
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm) {
                void clearMemories();
                setConfirm(false);
              } else setConfirm(true);
            }}
          >
            {confirm ? "Confirm clear all" : "Clear all"}
          </Button>
        </footer>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
