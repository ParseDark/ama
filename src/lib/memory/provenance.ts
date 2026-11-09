import type { Memory, MemorySource, Signal } from "./types";
import { hashText } from "./vectors";
export function sourcedSignal(
  sessionId: string,
  messageId: string | undefined,
  type: Signal["type"],
  text: string,
  domain?: string,
  suffix = "",
): Signal {
  const hash = hashText(text);
  return {
    sessionId,
    type,
    text,
    domain,
    source: {
      id: JSON.stringify([sessionId, messageId ?? suffix, type, suffix, hash]),
      sessionId,
      messageId,
      type,
      domain,
      hash,
    },
  };
}
export const mergeSources = (
  a: MemorySource[] = [],
  b: MemorySource[] = [],
) => [...new Map([...a, ...b].map((s) => [s.id, s])).values()];
export function recordChange(
  m: Memory,
  action: string,
  reason: string,
  at: number,
  previousText?: string,
) {
  return [
    ...(m.changes ?? []),
    { at, action, reason, ...(previousText ? { previousText } : {}) },
  ].slice(-20);
}
