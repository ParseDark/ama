import type { UIMessage } from "ai";
import { messageText } from "../messages";
import type { MemoryEvent, Signal, UserMessageMetadata } from "./types";
export const sensitiveDomain = (s?: string) =>
  !!s &&
  /bank|credit|loan|health|medical|clinic|hospital|pharmacy|insurance|payroll|tax|\.gov$|\.gov\./i.test(
    s,
  );
export function collectSignals(
  sessions: { id: string; messages: UIMessage[] }[],
  events: MemoryEvent[],
  cursors: Record<string, number> = {},
  eventCursor = 0,
) {
  const signals: Signal[] = [],
    nextCursors: Record<string, number> = {};
  for (const { id, messages } of sessions) {
    nextCursors[id] = messages.length;
    let metadata: UserMessageMetadata = {};
    for (let index = 0; index < messages.length; index++) {
      const m = messages[index];
      if (m.role === "user")
        metadata = (m.metadata ?? {}) as UserMessageMetadata;
      if (
        index < (cursors[id] ?? 0) ||
        metadata.incognito ||
        sensitiveDomain(metadata.domain)
      )
        continue;
      if (m.role === "user") {
        const text = messageText(m).slice(0, 500);
        if (text.trim())
          signals.push({
            sessionId: id,
            type: "user_msg",
            domain: metadata.domain,
            text,
          });
      }
      for (const p of m.parts) {
        if (!p.type.startsWith("tool-") && p.type !== "dynamic-tool") continue;
        const part = p as any,
          name = p.type === "dynamic-tool" ? part.toolName : p.type.slice(5);
        if (part.state === "output-denied")
          signals.push({
            sessionId: id,
            type: "approval",
            domain: metadata.domain,
            text: `denied ${name}`,
          });
        else if (part.approval?.approved === true)
          signals.push({
            sessionId: id,
            type: "approval",
            domain: metadata.domain,
            text: `allowed ${name}`,
          });
      }
    }
  }
  for (const e of events)
    if (e.ts > eventCursor && !sensitiveDomain(e.domain))
      signals.push({
        sessionId: e.sessionId,
        type: "stop",
        domain: e.domain,
        text: "stopped a reply",
      });
  return {
    signals: signals.slice(-60),
    cursors: nextCursors,
    eventCursor: Math.max(eventCursor, ...events.map((e) => e.ts)),
  };
}
