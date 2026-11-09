import type { UIMessage } from "ai";
import { messageText } from "../messages";
import { sourcedSignal } from "./provenance";
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
  limit = 60,
) {
  const signals: Signal[] = [],
    nextCursors: Record<string, number> = {};
  const result = (pending = false) => ({
    signals,
    cursors: nextCursors,
    eventCursor,
    pending,
  });
  // Preserve cursors for later sessions when a batch stops early.
  for (const { id, messages } of sessions)
    nextCursors[id] = Math.min(cursors[id] ?? 0, messages.length);
  for (const { id, messages } of sessions) {
    let metadata: UserMessageMetadata = {};
    for (let index = 0; index < messages.length; index++) {
      const m = messages[index];
      if (m.role === "user")
        metadata = (m.metadata ?? {}) as UserMessageMetadata;
      if (index < (cursors[id] ?? 0)) continue;
      if (metadata.incognito || sensitiveDomain(metadata.domain)) {
        nextCursors[id] = index + 1;
        continue;
      }
      const group: Signal[] = [];
      if (m.role === "user") {
        const text = messageText(m).slice(0, 500);
        if (text.trim())
          group.push(
            sourcedSignal(id, m.id, "user_msg", text, metadata.domain),
          );
      }
      for (const p of m.parts) {
        if (!p.type.startsWith("tool-") && p.type !== "dynamic-tool") continue;
        const part = p as any,
          name = p.type === "dynamic-tool" ? part.toolName : p.type.slice(5);
        if (part.state === "output-denied")
          group.push(
            sourcedSignal(
              id,
              m.id,
              "approval",
              `denied ${name}`,
              metadata.domain,
              part.toolCallId ?? name,
            ),
          );
        else if (part.approval?.approved === true)
          group.push(
            sourcedSignal(
              id,
              m.id,
              "approval",
              `allowed ${name}`,
              metadata.domain,
              part.toolCallId ?? name,
            ),
          );
      }
      // A message is atomic: never advance its cursor past unconsumed signals.
      if (signals.length && signals.length + group.length > limit)
        return result(true);
      signals.push(...group);
      nextCursors[id] = index + 1;
    }
  }
  const ordered = events
    .filter((e) => e.ts > eventCursor)
    .sort((a, b) => a.ts - b.ts);
  for (const e of ordered) {
    if (signals.length >= limit && e.ts > eventCursor) return result(true);
    // Events sharing a timestamp are atomic with the timestamp cursor.
    if (!sensitiveDomain(e.domain))
      signals.push(
        sourcedSignal(
          e.sessionId,
          undefined,
          "stop",
          "stopped a reply",
          e.domain,
          String(e.ts),
        ),
      );
    eventCursor = e.ts;
  }
  return result();
}
