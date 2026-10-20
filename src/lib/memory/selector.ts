import type { Memory } from "./types";
import { isActive } from "./types";
export const estimateTokens = (s: string) => {
  const cjk = (s.match(/[\u2e80-\u9fff\uac00-\ud7af\u3040-\u30ff]/g) ?? [])
    .length;
  return cjk + Math.ceil((s.length - cjk) / 4);
};
export interface MemoryPlan {
  injected: Memory[];
  otherReferences: Memory[];
  retrieval: "relevant" | "fallback";
}
export function planMemories(
  memories: Memory[],
  {
    domain,
    now = Date.now(),
    relevantIds = null,
  }: { domain?: string; now?: number; relevantIds?: Set<string> | null } = {},
): MemoryPlan {
  const score = (m: Memory) =>
    m.kind === "explicit" || m.pinned
      ? m.confidence
      : m.confidence * Math.exp(-Math.max(0, now - m.lastSeen) / 86400000 / 30);
  const applicable = memories
    .filter(
      (m) =>
        isActive(m) &&
        (!m.expiresAt || m.expiresAt > now) &&
        (m.scope === "global" || m.scope === `domain:${domain}`) &&
        score(m) >= 0.2,
    )
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        Number(b.kind === "explicit") - Number(a.kind === "explicit") ||
        score(b) - score(a) ||
        b.lastSeen - a.lastSeen,
    );
  const refs = applicable.filter((m) => m.category === "reference"),
    prefs = applicable.filter((m) => m.category !== "reference");
  const plan: MemoryPlan = {
    injected: [],
    otherReferences: [],
    retrieval: relevantIds === null ? "fallback" : "relevant",
  };
  for (const m of [...prefs, ...refs.filter((m) => relevantIds?.has(m.id))]) {
    const next = { ...plan, injected: [...plan.injected, m] };
    const blocks = splitMemoryBlocks(next, domain);
    if (estimateTokens(blocks.preferences + "\n" + blocks.references) <= 450)
      plan.injected.push(m);
  }
  plan.otherReferences = refs.filter((m) => !plan.injected.includes(m));
  return plan;
}
export function splitMemoryBlocks(plan: MemoryPlan, domain?: string) {
  const prefs = plan.injected.filter((m) => m.category !== "reference"),
    global = prefs.filter((m) => m.scope === "global"),
    site = prefs.filter((m) => m.scope !== "global");
  const lines = (ms: Memory[]) => ms.map((m) => `- ${m.text}`).join("\n");
  const preferences = prefs.length
    ? `<user_memory>\nThe user's saved preferences. Follow them unless the current request says otherwise. Don't mention them unless asked.\n${global.length ? lines(global) + "\n" : ""}${site.length ? `On ${domain}:\n${lines(site)}\n` : ""}</user_memory>`
    : "";
  const refs = plan.injected.filter((m) => m.category === "reference");
  const other = plan.otherReferences.length
    ? plan.retrieval === "relevant"
      ? "Other saved references exist; call recall_memory if the question may relate to one."
      : `Saved references (call recall_memory with a topic to read one if the question relates to it): ${plan.otherReferences.map((m) => m.topic ?? `${m.text.slice(0, 40)}…`).join("; ")}`
    : "";
  const references =
    refs.length || other
      ? `<user_memory_references>\n${refs.length ? `Saved references relevant to this message:\n${lines(refs)}\n` : ""}${other}${other ? "\n" : ""}</user_memory_references>`
      : "";
  return { preferences, references };
}
