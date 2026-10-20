import type { ToolSet } from "ai";
import type { EmbeddingConfig } from "./settings";
import { ensureVectors } from "./memory/vectors";
import { embedTexts, dot } from "./memory/embeddings";
export { toolsUsedIn } from "./messages";
export const FILTER_ABOVE = 12,
  KEEP_TOP = 8;
export async function filterMcpTools(
  tools: ToolSet,
  {
    queryVector,
    used = new Set(),
    config,
    embedDocuments = (t) =>
      embedTexts(config, t, "document", { signal: AbortSignal.timeout(2500) }),
    keep = KEEP_TOP,
  }: {
    queryVector: number[] | null;
    used?: Set<string>;
    config: EmbeddingConfig;
    embedDocuments?: (t: string[]) => Promise<number[][]>;
    keep?: number;
  },
) {
  const entries = Object.entries(tools);
  if (entries.length <= FILTER_ABOVE || !queryVector || !config.enabled)
    return tools;
  try {
    const vectors = await ensureVectors(
      entries.map(([id, t]) => ({ id, text: `${id}: ${t.description ?? ""}` })),
      config,
      embedDocuments,
      { namespace: "tools" },
    );
    const top = new Set(
      entries
        .map(([id]) => ({ id, score: dot(vectors.get(id)!, queryVector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, keep)
        .map((x) => x.id),
    );
    return Object.fromEntries(
      entries.filter(([id]) => top.has(id) || used.has(id)),
    );
  } catch {
    return tools;
  }
}
