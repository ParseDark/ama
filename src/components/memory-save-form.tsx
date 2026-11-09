import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { saveComposerMemory } from "@/lib/memory/composer-save";
import { findSensitiveContent } from "@/lib/memory/safety";
import { sensitiveDomain } from "@/lib/memory/signals";

export function MemorySaveForm({
  initialText,
  domain,
  incognito,
  enabled,
  onCancel,
  onSaved,
}: {
  initialText: string;
  domain?: string;
  incognito?: boolean;
  enabled: boolean;
  onCancel: () => void;
  onSaved: (text: string) => void;
}) {
  const [text, setText] = useState(initialText);
  const [category, setCategory] = useState<
    "preference" | "reference" | "procedure"
  >("preference");
  const [scope, setScope] = useState<"global" | "site">("global");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const privateContext = !!incognito || sensitiveDomain(domain);
  const sensitive = !!findSensitiveContent(text, { userTexts: [text] });
  return (
    <form
      className="command-memory-form"
      aria-label="Save memory preview"
      onSubmit={async (event) => {
        event.preventDefault();
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setError("");
        try {
          const result = await saveComposerMemory(
            { text, category, scope },
            { domain, incognito },
          );
          if (!result?.saved)
            throw new Error(result?.reason || "Could not save memory.");
          onSaved(result.text);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      }}
    >
      <strong>Save memory · preview</strong>
      <label>
        Memory content
        <textarea
          ref={input}
          aria-label="Memory content"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          disabled={saving}
        />
      </label>
      <div className="row">
        <label>
          Type
          <select
            aria-label="Memory type"
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            disabled={saving}
          >
            <option value="preference">Preference</option>
            <option value="reference">Reference</option>
            <option value="procedure">Procedure</option>
          </select>
        </label>
        <label>
          Scope
          <select
            aria-label="Memory scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
            disabled={saving}
          >
            <option value="global">Global</option>
            <option value="site" disabled={!domain}>
              This site{domain ? ` · ${domain}` : " · unavailable"}
            </option>
          </select>
        </label>
      </div>
      <p className="hint">
        Saved locally without encryption. Recalled text may go to your chat
        model and configured embedding service. This preview is saved directly,
        not sent to a model for interpretation. Use literal content, not
        “remember what I just said”.
      </p>
      {sensitive && (
        <p className="hint">
          Potential sensitive content will be saved as a reference, not an
          always-injected preference.
        </p>
      )}
      {category === "procedure" && privateContext && (
        <p role="alert">
          Procedures cannot be saved from private or sensitive-site sessions.
        </p>
      )}
      {!enabled && (
        <p role="alert">
          Memory is off. Enable it in the memory manager before saving.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="row">
        <Button
          size="sm"
          type="submit"
          disabled={
            saving ||
            !enabled ||
            !text.trim() ||
            (category === "procedure" && privateContext)
          }
        >
          {saving ? "Saving…" : "Save memory"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
