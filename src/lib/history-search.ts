import type { UIMessage } from "ai";
import type { EmbeddingConfig } from "./settings";
import { sessionsStore, loadSession, type SessionSummary } from "./sessions";
import { messageText } from "./messages";
import { embedTexts, dot } from "./memory/embeddings";
import { ensureVectors } from "./memory/vectors";
export interface Exchange {
  id: string;
  sessionId: string;
  sessionTitle: string;
  question: string;
  answer: string;
  updatedAt: number;
}
export function exchanges(
  session: SessionSummary,
  messages: UIMessage[],
): Exchange[] {
  return messages.flatMap((m, i) => {
    if (m.role !== "user" || (m.metadata as any)?.incognito) return [];
    const question = messageText(m).trim();
    if (!question) return [];
    const next = messages
      .slice(i + 1)
      .find((m) => m.role === "assistant" || m.role === "user");
    const answer = next?.role === "assistant" ? messageText(next) : "";
    return [
      {
        id: `${session.id}:${m.id}`,
        sessionId: session.id,
        sessionTitle: session.title,
        question,
        answer: answer.slice(0, 600) + (answer.length > 600 ? "…" : ""),
        updatedAt: session.updatedAt,
      },
    ];
  });
}
export async function searchHistory(
  query: string,
  {
    config,
    queryVector,
    excludeSessionId,
    limit = 5,
    fetchFn,
  }: {
    config: EmbeddingConfig;
    queryVector?: number[] | null;
    excludeSessionId?: string;
    limit?: number;
    fetchFn?: typeof fetch;
  },
): Promise<Exchange[]> {
  if (!query.trim()) return [];
  const sessions = (await sessionsStore.getValue()).filter(
    (s) => s.id !== excludeSessionId,
  );
  const entries = (
    await Promise.all(
      sessions.map(async (s) => exchanges(s, await loadSession(s.id))),
    )
  ).flat();
  if (!entries.length) return [];
  let ranked: { e: Exchange; score: number }[] | undefined;
  if (config.enabled)
    try {
      const signal = AbortSignal.timeout(5000);
      const [vectors, q] = await Promise.all([
        ensureVectors(
          entries.map((e) => ({
            id: e.id,
            text: `${e.question}\n${e.answer}`,
          })),
          config,
          (t) => embedTexts(config, t, "document", { fetchFn, signal }),
          { namespace: "history" },
        ),
        queryVector === undefined
          ? embedTexts(config, [query], "query", { fetchFn, signal }).then(
              (v) => v[0],
            )
          : Promise.resolve(queryVector),
      ]);
      if (q)
        ranked = entries
          .map((e) => ({ e, score: dot(vectors.get(e.id)!, q) }))
          .filter((x) => x.score >= config.minScore - 0.08);
    } catch {}
  if (!ranked) {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);
    ranked = entries
      .map((e) => ({
        e,
        score: words.reduce(
          (s, w) =>
            s +
            Number(
              `${e.sessionTitle} ${e.question} ${e.answer}`
                .toLowerCase()
                .includes(w),
            ),
          0,
        ),
      }))
      .filter((x) => x.score > 0);
  }
  ranked.sort((a, b) => b.score - a.score || b.e.updatedAt - a.e.updatedAt);
  const used = new Set<string>();
  return ranked
    .filter((x) => {
      if (used.has(x.e.sessionId)) return false;
      used.add(x.e.sessionId);
      return true;
    })
    .slice(0, limit)
    .map((x) => x.e);
}
