import type { EmbeddingConfig } from "../settings";
import type { Memory } from "./types";
import { isActive } from "./types";
import { listMemories, isMemoryEnabled } from "./store";
import { embedQuery, scoreReferences, pickRelevant } from "./retrieval";
import { planMemories } from "./selector";
export interface MemoryContext {
  memories: Memory[];
  scores: Map<string, number> | null;
}
export async function loadMemoryContext(
  queryVector: Promise<number[] | null>,
  config: EmbeddingConfig,
): Promise<MemoryContext> {
  if (!(await isMemoryEnabled())) return { memories: [], scores: new Map() };
  const memories = await listMemories();
  return {
    memories,
    scores: await scoreReferences(
      memories,
      memories.filter((m) => m.category === "reference" && isActive(m)),
      await queryVector,
      config,
    ),
  };
}
export const planFor = (
  context: MemoryContext,
  domain: string | undefined,
  config: EmbeddingConfig,
) =>
  planMemories(context.memories, {
    domain,
    relevantIds: context.scores
      ? new Set(pickRelevant(context.scores, config))
      : null,
  });
export function referenceSearch(
  context: MemoryContext,
  config: EmbeddingConfig,
) {
  return async (query: string) => {
    const refs = context.memories.filter(
      (m) =>
        m.category === "reference" &&
        isActive(m) &&
        (!m.expiresAt || m.expiresAt > Date.now()),
    );
    const vector = await embedQuery(query, config);
    const scores = await scoreReferences(
      context.memories,
      refs,
      vector,
      config,
    );
    if (scores)
      return refs
        .filter((m) => (scores.get(m.id) ?? -1) >= config.minScore - 0.08)
        .sort((a, b) => scores.get(b.id)! - scores.get(a.id)!)
        .slice(0, 5);
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);
    return refs
      .map((m) => ({
        m,
        score: words.reduce(
          (s, w) =>
            s + Number(`${m.topic ?? ""} ${m.text}`.toLowerCase().includes(w)),
          0,
        ),
      }))
      .filter((x) => x.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.m);
  };
}
