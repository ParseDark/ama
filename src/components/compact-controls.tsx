import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { Button } from "./ui/button";
import type { LocalChatTransport } from "@/lib/local-chat-transport";
import { loadCompact } from "@/lib/sessions";
import {
  hasPendingTools,
  validRecord,
  type CompactRecord,
} from "@/lib/compaction";

export function CompactControls({
  id,
  messages,
  busy,
  transport,
  onBusyChange,
}: {
  id: string;
  messages: UIMessage[];
  busy: boolean;
  transport: LocalChatTransport;
  onBusyChange: (busy: boolean) => void;
}) {
  const [record, setRecord] = useState<CompactRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (busy) return;
    let active = true;
    void loadCompact(id)
      .then(async (value) => {
        const valid = await validRecord(value, messages);
        if (active) setRecord(valid ? value : null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id, messages, busy]);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [id],
  );
  const latest = record;
  const compact = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setRunning(true);
    onBusyChange(true);
    try {
      setRecord(await transport.compact(id, messages, abort.signal));
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!abort.signal.aborted) {
        setRunning(false);
        onBusyChange(false);
      }
    }
  };
  return (
    <div className="px-1 pb-1 text-xs text-muted-foreground">
      <Button
        size="sm"
        variant="ghost"
        disabled={
          busy || running || hasPendingTools(messages) || !messages.length
        }
        onClick={() => void compact()}
      >
        {running ? "Compacting…" : "Compact"}
      </Button>
      {running && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            controller.current?.abort();
            setRunning(false);
            onBusyChange(false);
          }}
        >
          Cancel compact
        </Button>
      )}
      {latest && (
        <details>
          <summary>
            Compacted history · ~{latest.beforeTokens.toLocaleString()} →{" "}
            {latest.afterTokens.toLocaleString()} tokens
          </summary>
          <p>
            Historical prefix only, not the whole prompt. {latest.covered}{" "}
            messages · {(latest.durationMs / 1000).toFixed(1)}s · {latest.model}
            . Summary usage: {latest.inputTokens} in / {latest.outputTokens}{" "}
            out. Full chat retained locally; summaries are sent to the
            configured model.
          </p>
          <pre className="whitespace-pre-wrap">{latest.summary}</pre>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
