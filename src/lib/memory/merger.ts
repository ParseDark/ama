import type { Memory, MemoryOp } from "./types";
import { normalized, userOwned } from "./types";
import { findSensitiveContent } from "./safety";
/** A habit becomes a suggestion after this many separate sightings. */
export const EVIDENCE_NEEDED = 2;
export const isReadyToSuggest = (m: Memory) =>
  m.status === "suggested" && !m.disabled && m.evidence >= EVIDENCE_NEEDED;
export function applyMemoryOps(
  memories: Memory[],
  ops: MemoryOp[],
  { now = Date.now(), newId = (): string => crypto.randomUUID() } = {},
) {
  let ms = memories.map((m) => ({ ...m }));
  const reinforce = (m: Memory) => {
    if (m.status === "dismissed") return;
    m.evidence++;
    m.confidence = Math.min(1, Math.round((m.confidence + 0.1) * 100) / 100);
    m.lastSeen = now;
    if (m.kind === "context") m.expiresAt = now + 7 * 86400000;
  };
  for (const op of ops) {
    if (op.text && findSensitiveContent(op.text)) continue;
    const m = ms.find((m) => m.id === op.id);
    if (op.op === "add" && op.text) {
      const scope =
        op.scope === "site" && op.domain
          ? (`domain:${op.domain}` as const)
          : "global";
      const existing = ms.find(
        (m) => m.scope === scope && normalized(m.text) === normalized(op.text!),
      );
      if (existing) {
        reinforce(existing);
        continue;
      }
      ms.push({
        id: newId(),
        kind: op.kind ?? "inferred",
        scope,
        text: op.text,
        evidence: 1,
        confidence: 0.5,
        status: "suggested",
        category: "preference",
        createdAt: now,
        lastSeen: now,
        ...(op.kind === "context" ? { expiresAt: now + 7 * 86400000 } : {}),
      });
    } else if (m && op.op === "reinforce") reinforce(m);
    else if (
      m &&
      op.op === "update" &&
      op.text &&
      !userOwned(m) &&
      (m.status === "suggested" || m.kind === "context")
    ) {
      m.text = op.text;
      m.lastSeen = now;
    } else if (m && op.op === "delete" && !userOwned(m))
      ms = ms.filter((x) => x.id !== m.id);
  }
  return ms;
}
