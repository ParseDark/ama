import { storage } from "wxt/utils/storage";
import { z } from "zod";
import type { Memory, MemoryEvent } from "./types";
const memorySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["explicit", "inferred", "context"]),
  scope: z.string().regex(/^(global|domain:.+)$/),
  text: z.string().min(1).max(10000),
  evidence: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  lastSeen: z.number(),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
  pinned: z.boolean().optional(),
  disabled: z.boolean().optional(),
  status: z.enum(["active", "suggested", "dismissed"]).optional(),
  category: z.enum(["preference", "reference"]).optional(),
  topic: z.string().max(60).optional(),
  supersededBy: z.string().optional(),
});
export const memoryStore = storage.defineItem<{
  schemaVersion: 1;
  memories: Memory[];
  enabled: boolean;
}>("local:memory", {
  fallback: { schemaVersion: 1, memories: [], enabled: true },
});
export const memoryEventsStore = storage.defineItem<MemoryEvent[]>(
  "local:memoryEvents",
  { fallback: [] },
);
export const distinctStore = storage.defineItem<string[]>(
  "local:memoryDistinctPairs",
  { fallback: [] },
);
export const listMemories = async () => (await memoryStore.getValue()).memories;
export const isMemoryEnabled = async () =>
  (await memoryStore.getValue()).enabled;
const locked = <T>(f: () => Promise<T>) =>
  navigator.locks ? navigator.locks.request("ama-memory-store", f) : f();
export const setMemoryEnabled = (enabled: boolean) =>
  locked(async () =>
    memoryStore.setValue({ ...(await memoryStore.getValue()), enabled }),
  );
export const updateMemories = (fn: (m: Memory[]) => Memory[]) =>
  locked(async () => {
    const s = await memoryStore.getValue();
    await memoryStore.setValue({ ...s, memories: fn(s.memories) });
  });
export const upsertMemory = (m: Memory) =>
  updateMemories((ms) => [...ms.filter((x) => x.id !== m.id), m]);
export const removeMemory = (id: string) =>
  updateMemories((ms) => ms.filter((m) => m.id !== id));
export const clearMemories = () => updateMemories(() => []);
export const confirmSuggestion = (m: Memory): Memory => ({
  ...m,
  kind: m.kind === "context" ? "context" : "explicit",
  status: "active",
  confidence: 1,
});
export const acceptSuggestion = (id: string) =>
  updateMemories((ms) =>
    ms.map((m) => (m.id === id ? confirmSuggestion(m) : m)),
  );
export const dismissSuggestion = (id: string) =>
  updateMemories((ms) =>
    ms.map((m) => (m.id === id ? { ...m, status: "dismissed" } : m)),
  );
export const undoRemember = (id: string, replacedIds: string[] = []) =>
  updateMemories((ms) =>
    ms
      .filter((m) => m.id !== id)
      .map((m) => {
        if (!replacedIds.includes(m.id)) return m;
        const { supersededBy, ...rest } = m;
        return { ...rest, disabled: false };
      }),
  );
export const distinctKey = (a: string, b: string) => [a, b].sort().join("|");
export const markDistinct = async (a: string, b: string) =>
  distinctStore.setValue([
    ...new Set([...(await distinctStore.getValue()), distinctKey(a, b)]),
  ]);
export const keepMemory = (keepId: string, dropId: string) =>
  updateMemories((ms) => {
    const drop = ms.find((m) => m.id === dropId);
    return ms
      .filter((m) => m.id !== dropId)
      .map((m) =>
        m.id === keepId
          ? {
              ...m,
              evidence: m.evidence + (drop?.evidence ?? 0),
              pinned: !!(m.pinned || drop?.pinned),
            }
          : m,
      );
  });
export async function importMemories(json: string) {
  const parsed = z
    .object({ schemaVersion: z.literal(1), memories: z.array(memorySchema) })
    .parse(JSON.parse(json));
  await updateMemories((ms) => [
    ...new Map(
      [...ms, ...(parsed.memories as Memory[])].map((m) => [m.id, m]),
    ).values(),
  ]);
}
export const exportMemories = async () =>
  JSON.stringify({ schemaVersion: 1, memories: await listMemories() }, null, 2);
export async function logMemoryEvent(event: MemoryEvent) {
  const cutoff = Date.now() - 30 * 86400000;
  await memoryEventsStore.setValue(
    [...(await memoryEventsStore.getValue()), event].filter(
      (e) => e.ts >= cutoff,
    ),
  );
}
