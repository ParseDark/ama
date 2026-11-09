import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import type { LocalChatTransport } from "@/lib/local-chat-transport";
import { loadCompact } from "@/lib/sessions";
import {
  hasPendingTools,
  validRecord,
  type CompactRecord,
} from "@/lib/compaction";

/** One controller for the button and composer command; never replay a tool chain. */
export function useCompact({
  id,
  messages,
  busy,
  transport,
}: {
  id: string;
  messages: UIMessage[];
  busy: boolean;
  transport: LocalChatTransport;
}) {
  const [record, setRecord] = useState<CompactRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [id]);
  useEffect(() => {
    if (busy || running) return;
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
  }, [id, messages, busy, running]);
  const disabledReason = running
    ? "Compact is already running."
    : busy
      ? "Wait for the current reply to finish."
      : hasPendingTools(messages)
        ? "Finish or deny pending tool approvals first."
        : !messages.length
          ? "Start a conversation before compacting."
          : "";
  const compact = async () => {
    if (disabledReason || controller.current) return false;
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setRunning(true);
    try {
      const value = await transport.compact(id, messages, abort.signal);
      if (mounted.current && !abort.signal.aborted) setRecord(value);
    } catch (e) {
      if (mounted.current && !abort.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        if (mounted.current) setRunning(false);
      }
    }
    return true;
  };
  return {
    record,
    running,
    error,
    disabledReason,
    compact,
    cancel: () => {
      controller.current?.abort();
      controller.current = null;
      setRunning(false);
    },
  };
}
