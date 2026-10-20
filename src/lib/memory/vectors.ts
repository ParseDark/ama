import { storage } from "wxt/utils/storage";
import type { EmbeddingConfig } from "../settings";
import { embedTexts } from "./embeddings";
export interface VectorCache {
  key: string;
  entries: Record<string, { hash: string; vector: number[] }>;
}
export function hashText(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
export async function ensureVectors(
  entries: { id: string; text: string }[],
  config: EmbeddingConfig,
  embedDocuments: (texts: string[]) => Promise<number[][]> = (t) =>
    embedTexts(config, t, "document"),
  {
    namespace = "memories",
    prune = namespace === "memories",
  }: { namespace?: string; prune?: boolean } = {},
) {
  const storageKey =
    namespace === "memories"
      ? "local:memoryVectors"
      : (`local:vectors:${namespace}` as const);
  const key = `${config.url}|${config.model}|${config.dimensions}`;
  const old = await storage.getItem<VectorCache>(storageKey);
  const cache: VectorCache =
    old?.key === key
      ? { key, entries: { ...old.entries } }
      : { key, entries: {} };
  const stale = entries.filter(
    (e) => cache.entries[e.id]?.hash !== hashText(e.text),
  );
  let changed = old?.key !== key;
  if (stale.length) {
    const vectors = await embedDocuments(stale.map((e) => e.text));
    stale.forEach((e, i) => {
      cache.entries[e.id] = { hash: hashText(e.text), vector: vectors[i] };
    });
    changed = true;
  }
  if (prune) {
    const ids = new Set(entries.map((e) => e.id));
    for (const id of Object.keys(cache.entries))
      if (!ids.has(id)) {
        delete cache.entries[id];
        changed = true;
      }
  }
  if (changed) await storage.setItem(storageKey, cache);
  return new Map(entries.map((e) => [e.id, cache.entries[e.id].vector]));
}
