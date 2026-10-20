export type MemoryKind = "explicit" | "inferred" | "context";
export type MemoryScope = "global" | `domain:${string}`;
export interface Memory {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  text: string;
  evidence: number;
  confidence: number;
  lastSeen: number;
  createdAt: number;
  expiresAt?: number;
  pinned?: boolean;
  disabled?: boolean;
  status?: "active" | "suggested" | "dismissed";
  category?: "preference" | "reference";
  topic?: string;
  supersededBy?: string;
}
export interface UserMessageMetadata {
  domain?: string;
  incognito?: boolean;
}
export interface Signal {
  sessionId: string;
  type: "user_msg" | "approval" | "stop";
  domain?: string;
  text: string;
}
export interface MemoryEvent {
  ts: number;
  type: "stop";
  domain?: string;
  sessionId: string;
}
export interface MemoryOp {
  op: "add" | "reinforce" | "update" | "delete";
  id?: string;
  kind?: "inferred" | "context";
  scope?: "global" | "site";
  domain?: string;
  text?: string;
  reason: string;
}
export const normalized = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[。.!！]+$/, "")
    .trim();
export const isActive = (m: Memory) =>
  !m.disabled && (!m.status || m.status === "active");
export const userOwned = (m: Memory) => m.kind === "explicit" || !!m.pinned;
