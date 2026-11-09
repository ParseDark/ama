import type { Memory, MemoryOp } from "./types";
import { normalized, userOwned } from "./types";
import { findSensitiveContent } from "./safety";
import { mergeSources, recordChange } from "./provenance";
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
  const reinforce = (m: Memory, op: MemoryOp) => {
    if (m.status === "dismissed") return;
    const sources = mergeSources(m.sources, op.sources);
    const independent = new Set(
      (m.sources ?? [])
        .filter((s) => s.type === "user_msg")
        .map((s) => `${s.sessionId}:${s.messageId}`),
    );
    const added = new Set(
      sources
        .filter(
          (s) =>
            s.type === "user_msg" &&
            !independent.has(`${s.sessionId}:${s.messageId}`),
        )
        .map((s) => `${s.sessionId}:${s.messageId}`),
    ).size;
    if (op.sources && !added) return;
    m.sources = sources;
    m.evidence += op.sources ? added : 1;
    m.confidence = Math.min(1, Math.round((m.confidence + 0.1) * 100) / 100);
    m.lastSeen = now;
    m.reason = op.reason;
    m.changes = recordChange(m, "reinforce", op.reason, now);
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
        reinforce(existing, op);
        continue;
      }
      ms.push({
        id: newId(),
        kind: op.kind ?? "inferred",
        scope,
        text: op.text,
        evidence: op.sources
          ? new Set(
              op.sources
                .filter((s) => s.type === "user_msg")
                .map((s) => `${s.sessionId}:${s.messageId}`),
            ).size
          : 1,
        confidence: 0.5,
        status: "suggested",
        category: "preference",
        createdAt: now,
        lastSeen: now,
        sources: op.sources,
        verification: "inferred",
        reason: op.reason,
        changes: [{ at: now, action: "add", reason: op.reason }],
        ...(op.kind === "context" ? { expiresAt: now + 7 * 86400000 } : {}),
      });
    } else if (m && op.op === "reinforce") reinforce(m, op);
    else if (
      m &&
      op.op === "update" &&
      op.text &&
      !userOwned(m) &&
      (m.status === "suggested" || m.kind === "context")
    ) {
      m.changes = recordChange(m, "update", op.reason, now, m.text);
      m.text = op.text;
      m.sources = mergeSources(m.sources, op.sources);
      m.reason = op.reason;
      m.lastSeen = now;
    } else if (m && op.op === "delete" && !userOwned(m)) {
      m.disabled = true;
      m.changes = recordChange(m, "archive", op.reason, now);
    }
  }
  return ms;
}
