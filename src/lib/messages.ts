import type { UIMessage } from "ai";
export const messageText = (m: UIMessage) =>
  m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");
export const latestUserText = (messages: UIMessage[]) => {
  const m = messages.findLast((m) => m.role === "user");
  return m ? messageText(m) : "";
};
export const toolsUsedIn = (messages: UIMessage[]) =>
  new Set(
    messages.flatMap((m) =>
      m.parts.flatMap((p) =>
        p.type.startsWith("tool-")
          ? [p.type.slice(5)]
          : p.type === "dynamic-tool"
            ? [(p as any).toolName]
            : [],
      ),
    ),
  );
