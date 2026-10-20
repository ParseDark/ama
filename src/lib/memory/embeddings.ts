import type { EmbeddingConfig } from "../settings";
export const dot = (a: number[], b: number[]) =>
  a.length === b.length ? a.reduce((sum, v, i) => sum + v * b[i], 0) : 0;
export async function embedTexts(
  config: EmbeddingConfig,
  texts: string[],
  input_type: "query" | "document",
  {
    signal,
    fetchFn = (i, n) => globalThis.fetch(i, n),
  }: { signal?: AbortSignal; fetchFn?: typeof fetch } = {},
) {
  const result: number[][] = [];
  for (let start = 0; start < texts.length; start += 32) {
    const batch = texts.slice(start, start + 32);
    const r = await fetchFn(`${config.url.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        input: batch,
        input_type,
        dimensions: config.dimensions,
      }),
    });
    if (!r.ok) {
      const raw = await r.text();
      let msg = raw.slice(0, 200);
      try {
        msg = JSON.parse(raw).error?.message ?? msg;
      } catch {}
      throw new Error(`Embedding request failed (${r.status}): ${msg}`);
    }
    const data = await r.json();
    if (!Array.isArray(data.data) || data.data.length !== batch.length)
      throw new Error(
        "Embedding server returned an invalid number of vectors.",
      );
    for (const [i, item] of [...data.data]
      .sort((a, b) => a.index - b.index)
      .entries()) {
      const v = item.embedding as number[];
      if (
        item.index !== i ||
        !Array.isArray(v) ||
        v.length === 0 ||
        v.some((n) => !Number.isFinite(n))
      )
        throw new Error("Invalid embedding vector.");
      const norm = Math.hypot(...v);
      result.push(v.map((x) => (norm ? x / norm : 0)));
    }
  }
  return result;
}
