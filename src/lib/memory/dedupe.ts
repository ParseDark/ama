import type { Memory, MemoryOp } from "./types";
import { isActive, userOwned } from "./types";
import type { EmbeddingConfig } from "../settings";
import { embedTexts, dot } from "./embeddings";
import { ensureVectors } from "./vectors";
import { distinctKey } from "./store";
import type { MemoryRelation } from "./relation";
export async function findSimilarPairs(
  memories: Memory[],
  {
    config,
    embedDocuments = (t) =>
      embedTexts(config, t, "document", { signal: AbortSignal.timeout(2500) }),
    distinct = [],
  }: {
    config: EmbeddingConfig;
    embedDocuments?: (texts: string[]) => Promise<number[][]>;
    distinct?: string[];
  },
) {
  if (!config.enabled) return [];
  try {
    const vectors = await ensureVectors(memories, config, embedDocuments),
      ms = memories.filter(isActive),
      pairs: { a: Memory; b: Memory; score: number }[] = [];
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i],
          b = ms[j];
        if (a.scope !== b.scope || distinct.includes(distinctKey(a.id, b.id)))
          continue;
        const score = dot(vectors.get(a.id)!, vectors.get(b.id)!);
        if (score >= 0.7) pairs.push({ a, b, score });
      }
    return pairs.sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}
export async function refineLearnedOps(
  ops: MemoryOp[],
  memories: Memory[],
  relate: (
    text: string,
    scope: Memory["scope"],
  ) => Promise<MemoryRelation | null>,
) {
  const result: MemoryOp[] = [];
  for (const op of ops) {
    if (op.op !== "add" || !op.text) {
      result.push(op);
      continue;
    }
    const r = await relate(
      op.text,
      op.scope === "site" && op.domain ? `domain:${op.domain}` : "global",
    );
    if (r?.duplicateOf) {
      if (memories.find((m) => m.id === r.duplicateOf)?.status !== "dismissed")
        result.push({ op: "reinforce", id: r.duplicateOf, reason: op.reason });
      continue;
    }
    if (
      r?.contradicts.some((id) => {
        const m = memories.find((m) => m.id === id);
        return m && (userOwned(m) || isActive(m));
      })
    )
      continue;
    result.push(op);
  }
  return result;
}
