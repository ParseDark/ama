import type { EmbeddingConfig } from "../settings";
import type { Memory } from "./types";
import { embedTexts, dot } from "./embeddings";
import { ensureVectors } from "./vectors";
export async function embedQuery(
  query: string,
  config: EmbeddingConfig,
  {
    timeoutMs = 2500,
    fetchFn,
  }: { timeoutMs?: number; fetchFn?: typeof fetch } = {},
) {
  if (!config.enabled || !query.trim()) return null;
  try {
    return (
      await embedTexts(config, [query], "query", {
        signal: AbortSignal.timeout(timeoutMs),
        fetchFn,
      })
    )[0];
  } catch {
    return null;
  }
}
export async function scoreReferences(
  memories: Memory[],
  references: Memory[],
  queryVector: number[] | null,
  config: EmbeddingConfig,
) {
  if (!references.length) return new Map<string, number>();
  if (!queryVector || !config.enabled) return null;
  try {
    const vectors = await ensureVectors(memories, config, (t) =>
      embedTexts(config, t, "document", { signal: AbortSignal.timeout(2500) }),
    );
    return new Map(
      references.map((m) => [m.id, dot(vectors.get(m.id)!, queryVector)]),
    );
  } catch {
    return null;
  }
}
export function pickRelevant(
  scores: Map<string, number>,
  {
    minScore,
    margin = 0.08,
    topK = 3,
  }: { minScore: number; margin?: number; topK?: number },
) {
  const ordered = [...scores.values()].sort((a, b) => a - b),
    mid = Math.floor(ordered.length / 2),
    median =
      ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
  return [...scores]
    .filter(
      ([, s]) => s >= minScore && (scores.size < 3 || s - median >= margin),
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id]) => id);
}
