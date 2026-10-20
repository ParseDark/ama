import { tool } from "ai";
import { z } from "zod";
import type { Memory, MemoryScope } from "./types";
import { normalized } from "./types";
import { isMemoryEnabled, listMemories, updateMemories } from "./store";
import { findSensitiveContent } from "./safety";
import type { MemoryRelation } from "./relation";
const reasons = new Map<string, string>();
export const getMemoryApprovalReason = (id: string) => reasons.get(id);
export function createMemoryTools({
  userTexts,
  domain,
  dangerMode = false,
  judgeIntent,
  searchReferences,
  relate = async () => null,
  now = Date.now,
  newId = () => crypto.randomUUID(),
}: {
  userTexts: string[];
  domain?: string;
  dangerMode?: boolean;
  judgeIntent: () => Promise<boolean | null>;
  searchReferences: (q: string) => Promise<Memory[]>;
  relate?: (text: string, scope: MemoryScope) => Promise<MemoryRelation | null>;
  now?: () => number;
  newId?: () => string;
}) {
  let intent: Promise<boolean | null> | undefined;
  const approval = async (text: string, id: string, forget = false) => {
    if (!(await isMemoryEnabled()) || dangerMode === true) return false;
    const sensitive = findSensitiveContent(text, { userTexts });
    const asks = await (intent ??= judgeIntent());
    const lines: string[] = [];
    if (sensitive && sensitive !== "a URL" && !forget)
      lines.push(
        "This may contain sensitive information. Saved locally without encryption; recalled text may be sent to your chat model and configured embedding service.",
      );
    if (sensitive === "a URL")
      lines.push("It contains a link you didn't type in this chat.");
    if (asks === false)
      lines.push(`You didn't ask to ${forget ? "forget" : "save"} this.`);
    if (asks === null)
      lines.push(
        `Couldn't confirm you asked to ${forget ? "forget" : "save"} this.`,
      );
    reasons.set(id, lines.join(" "));
    return lines.length > 0;
  };
  return {
    remember: tool({
      description: `Remember a lasting user preference or reference for future chats. Sensitive facts are saved as references, not always-injected preferences.${dangerMode === true ? " Danger mode: saves execute without approval." : " Potential credentials/card numbers require confirmation."}`,
      inputSchema: z.object({
        text: z.string().min(1).max(300),
        scope: z.enum(["global", "site"]).optional(),
        category: z.enum(["preference", "reference"]).optional(),
        topic: z.string().max(60).optional(),
      }),
      needsApproval: (i, o) => approval(i.text, o.toolCallId),
      execute: async ({ text, scope, category = "preference", topic }) => {
        if (!(await isMemoryEnabled()))
          return { saved: false, reason: "Memory is turned off in settings." };
        const sensitive = findSensitiveContent(text, { userTexts: [text] });
        // Explicit saves are user-controlled, not subject to the automatic
        // learner's sensitive-data denylist. Keep secrets out of every reply's
        // preference block; they remain available through relevant recall.
        const savedCategory = sensitive ? "reference" : category;
        const resolved: MemoryScope =
          scope === "site" && domain ? `domain:${domain}` : "global";
        let result: any;
        const existing = await listMemories();
        const exact = existing.find(
          (m) =>
            m.scope === resolved && normalized(m.text) === normalized(text),
        );
        const relation = exact ? null : await relate(text, resolved);
        await updateMemories((ms) => {
          const duplicate = ms.find(
            (m) => m.id === (exact?.id ?? relation?.duplicateOf),
          );
          if (duplicate) {
            result = {
              saved: true,
              id: duplicate.id,
              text: duplicate.text,
              scope: duplicate.scope,
              duplicate: true,
            };
            return ms.map((m) =>
              m.id === duplicate.id
                ? {
                    ...m,
                    evidence: m.evidence + 1,
                    lastSeen: now(),
                    disabled: false,
                    status: "active",
                    ...(sensitive
                      ? {
                          category: "reference" as const,
                          topic: topic || "Private reference",
                        }
                      : {}),
                  }
                : m,
            );
          }
          const id = newId(),
            ts = now();
          const replaced = ms.filter((m) =>
            relation?.contradicts.includes(m.id),
          );
          result = {
            saved: true,
            id,
            text,
            scope: resolved,
            ...(replaced.length
              ? { replaced: replaced.map(({ id, text }) => ({ id, text })) }
              : {}),
          };
          return [
            ...ms.map((m) =>
              replaced.includes(m)
                ? { ...m, disabled: true, supersededBy: id }
                : m,
            ),
            {
              id,
              text,
              scope: resolved,
              kind: "explicit",
              evidence: 1,
              confidence: 1,
              lastSeen: ts,
              createdAt: ts,
              category: savedCategory,
              ...(sensitive
                ? { topic: topic || "Private reference" }
                : savedCategory === "reference" && topic
                  ? { topic }
                  : {}),
            },
          ];
        });
        return result;
      },
    }),
    forget: tool({
      description: "Forget saved memories matching a query.",
      inputSchema: z.object({ query: z.string().min(1) }),
      needsApproval: (i, o) => approval(i.query, o.toolCallId, true),
      execute: async ({ query }) => {
        if (!(await isMemoryEnabled()))
          return { removed: [], error: "Memory is turned off in settings." };
        let removed: { id: string; text: string }[] = [];
        await updateMemories((ms) => {
          removed = ms
            .filter((m) => normalized(m.text).includes(normalized(query)))
            .map(({ id, text }) => ({ id, text }));
          return ms.filter((m) => !removed.some((r) => r.id === m.id));
        });
        return removed.length
          ? { removed }
          : { removed, error: `No saved memory mentions "${query}".` };
      },
    }),
    recall_memory: tool({
      description: "Look up saved references by topic.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        if (!(await isMemoryEnabled()))
          return { matches: [], note: "Memory is turned off in settings." };
        const matches = await searchReferences(query);
        return matches.length
          ? { matches: matches.map(({ text, topic }) => ({ text, topic })) }
          : { matches: [], note: "No saved reference matches this." };
      },
    }),
  };
}
