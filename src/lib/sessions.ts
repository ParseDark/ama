import { storage } from "wxt/utils/storage";
import type { UIMessage } from "ai";
import { messageText } from "./messages";
import { deleteSessionData } from "./data/store";
import { networkClient } from "./network/client";
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
export const sessionsStore = storage.defineItem<SessionSummary[]>(
  "local:sessions",
  { fallback: [] },
);
export const activeSessionStore = storage.defineItem<string | null>(
  "local:activeSessionId",
  { fallback: null },
);
export const loadSession = (id: string) =>
  storage.getItem<UIMessage[]>(`local:session:${id}`, { fallback: [] });
export function sessionTitle(messages: UIMessage[]) {
  const m = messages.find((m) => m.role === "user");
  const t = m ? messageText(m).trim() : "";
  return t
    ? t.slice(0, 60) + (t.length > 60 ? "…" : "")
    : m?.parts.some((p) => p.type === "file")
      ? "Screenshot"
      : "New chat";
}
let writes: Promise<unknown> = Promise.resolve();
// Block late chat saves as soon as deletion is requested, even while queued.
const deletedSessions = new Set<string>();
function queue<T>(f: () => Promise<T>): Promise<T> {
  const p = writes.then(f, f);
  writes = p.catch(() => {});
  return p;
}
export const saveSession = (id: string, messages: UIMessage[]) =>
  queue(async () => {
    if (!messages.length || deletedSessions.has(id)) return;
    const sessions = await sessionsStore.getValue(),
      old = sessions.find((s) => s.id === id),
      now = Date.now();
    await storage.setItem(`local:session:${id}`, messages);
    await sessionsStore.setValue([
      {
        id,
        title: sessionTitle(messages),
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      },
      ...sessions.filter((s) => s.id !== id),
    ]);
    await activeSessionStore.setValue(id);
  });
export const deleteSession = (id: string) => {
  deletedSessions.add(id);
  return queue(async () => {
    // Tombstone first: an already running tool must not recreate orphan data.
    await deleteSessionData(id);
    // Clear only after the tombstone is durable: in-flight stop/save operations
    // cannot recreate session data while the background snapshot is discarded.
    try {
      await networkClient.clear(id);
    } catch (e) {
      // A different owner has no snapshot belonging to this session to clear.
      if (
        !(e instanceof Error) ||
        e.message !== "Capture belongs to another session"
      )
        throw e;
    }
    await storage.removeItem(`local:session:${id}`);
    await sessionsStore.setValue(
      (await sessionsStore.getValue()).filter((s) => s.id !== id),
    );
    if ((await activeSessionStore.getValue()) === id)
      await activeSessionStore.setValue(null);
  });
};
