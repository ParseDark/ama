import type { UIMessage } from "ai";

type MessagePart = UIMessage["parts"][number];

// These static tool parts may still exist in saved chats. A dynamic MCP tool
// with the same name is not a retired native workspace invocation.
const names: ReadonlySet<string> = new Set([
  "list_files",
  "find_files",
  "search_files",
  "read_file",
  "create_file",
  "edit_file",
  "patch_file",
  "delete_file",
]);

export function retiredWorkspaceToolName(
  part: MessagePart,
): string | undefined {
  const name = part.type.startsWith("tool-") ? part.type.slice(5) : "";
  return names.has(name) ? name : undefined;
}

/** Model/approval view only. Do not persist this projection over the chat. */
export function withoutRetiredWorkspaceTools(
  messages: UIMessage[],
): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const parts = message.parts.filter(
      (part) => !retiredWorkspaceToolName(part),
    );
    return parts.length === message.parts.length
      ? message
      : { ...message, parts };
  });
}
