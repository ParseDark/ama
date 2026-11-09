export type MemoryKind = "explicit" | "inferred" | "context";
export type MemoryScope = "global" | `domain:${string}`;
export interface MemorySource {
  id: string;
  sessionId: string;
  messageId?: string;
  type: "user_msg" | "approval" | "stop";
  domain?: string;
  /** Hash of the original signal; an edited message is not the same evidence. */
  hash: string;
}
export interface MemoryChange {
  at: number;
  action: string;
  reason: string;
  previousText?: string;
}
export interface MemoryReview {
  action: "revise" | "archive";
  text?: string;
  reason: string;
  sources: MemorySource[];
  createdAt: number;
}
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
  category?: "preference" | "reference" | "procedure";
  topic?: string;
  supersededBy?: string;
  sources?: MemorySource[];
  verification?: "inferred" | "user-confirmed";
  reason?: string;
  changes?: MemoryChange[];
  lastReviewedAt?: number;
  review?: MemoryReview;
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
  source?: MemorySource;
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
  sourceIds?: string[];
  /** Resolved by the harness, never trusted from the model. */
  sources?: MemorySource[];
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
export const isReference = (m: Memory) =>
  m.category === "reference" || m.category === "procedure";
