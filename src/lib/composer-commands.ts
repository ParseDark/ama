export type ComposerCommandId = "compact" | "memory" | "memory-list";
export interface ComposerCommand {
  id: ComposerCommandId;
  title: string;
  description: string;
  keywords: string[];
}
/** Local commands are dispatched by the UI, never interpreted as model instructions. */
export const composerCommands: ComposerCommand[] = [
  {
    id: "compact",
    title: "Compact conversation",
    description: "Summarize older turns · uses your chat model",
    keywords: ["压缩", "上下文", "摘要", "summarize", "context"],
  },
  {
    id: "memory",
    title: "Save a memory",
    description: "Preview a preference, reference or procedure before saving",
    keywords: ["记住", "保存", "记忆", "remember", "save"],
  },
  {
    id: "memory-list",
    title: "View memories",
    description: "Open the local memory manager · no model request",
    keywords: ["记忆", "列表", "查看", "list", "manage"],
  },
];
export function commandQuery(text: string, start: number, end = start) {
  if (start !== end) return null;
  // Only a leading token is an action. Emails, inline mentions and pasted prose
  // must not accidentally become commands. Future resource mentions are separate.
  const match = /^\s*@([^\s@]*)$/u.exec(text.slice(0, start));
  return match
    ? { query: match[1], start: text.indexOf("@"), end: start }
    : null;
}
export function matchingCommands(query: string) {
  const q = query.toLocaleLowerCase();
  return composerCommands.filter((c) =>
    [c.id, c.title, ...c.keywords].some((s) =>
      s.toLocaleLowerCase().includes(q),
    ),
  );
}
export function parseComposerCommand(text: string) {
  const match = /^\s*@([a-z-]+)(?:\s+([\s\S]*))?$/i.exec(text);
  const command = composerCommands.find(
    (c) => c.id === match?.[1].toLowerCase(),
  );
  return command
    ? { id: command.id, argument: (match?.[2] ?? "").trim() }
    : null;
}
