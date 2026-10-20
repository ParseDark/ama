import { useState } from "react";
import type { UIMessage } from "ai";
import { Copy, Check, Brain } from "lucide-react";
import { messageText } from "@/lib/messages";
import { Markdown } from "./markdown";
import { ToolPart, PlanPart } from "./tool-parts";
import { Button } from "./ui/button";
import { GenerationStatsView } from "./generation-stats";
import { FileChanges } from "./file-changes";
import type { GenerationStats } from "@/lib/generation-stats";
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.cssText = "position:fixed;opacity:0;";
    document.body.append(el);
    el.select();
    if (!document.execCommand("copy")) {
      el.remove();
      throw new Error("Copy failed.");
    }
    el.remove();
  }
}
export function ChatMessage({
  message,
  streaming,
  onApproval,
}: {
  message: UIMessage;
  streaming: boolean;
  onApproval: (v: { id: string; approved: boolean }) => void;
}) {
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const plans = message.parts.filter((p) => p.type === "tool-plan"),
    firstPlan = message.parts.findIndex((p) => p.type === "tool-plan");
  const memories = (message.metadata as any)?.usedMemories ?? [];
  const stats = (
    message.metadata as { generationStats?: GenerationStats } | undefined
  )?.generationStats;
  return (
    <article className={`message message-${message.role}`}>
      <div className="message-label">
        {message.role === "user" ? "You" : "AMA"}
      </div>
      {message.parts.map((part, i) => {
        if (part.type === "text")
          return message.role === "user" ? (
            <div className="user-bubble" key={i}>
              {part.text}
            </div>
          ) : (
            <Markdown key={i} streaming={streaming}>
              {part.text}
            </Markdown>
          );
        if (part.type === "reasoning")
          return (
            <details key={i} className="reasoning">
              <summary>Reasoning</summary>
              {part.text}
            </details>
          );
        if (part.type === "file" && part.mediaType.startsWith("image/"))
          return (
            <a key={i} href={part.url} target="_blank" rel="noreferrer">
              <img
                className="message-image"
                src={part.url}
                alt="Attached screenshot"
              />
            </a>
          );
        if (part.type === "tool-plan")
          return i === firstPlan ? (
            <PlanPart key={i} part={plans.at(-1)} />
          ) : null;
        if (part.type.startsWith("tool-") || part.type === "dynamic-tool")
          return <ToolPart key={i} part={part} onApproval={onApproval} />;
        return null;
      })}
      {message.role === "assistant" && !streaming && (
        <FileChanges message={message} />
      )}
      {message.role === "assistant" && stats && (
        <GenerationStatsView stats={stats} />
      )}
      {message.role === "assistant" && !streaming && messageText(message) && (
        <div className="message-footer">
          <Button
            variant="ghost"
            size="sm"
            aria-label={copied ? "Copied" : "Copy"}
            onClick={async () => {
              try {
                await copyText(messageText(message));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch (e) {
                setCopyError(String(e));
              }
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}{" "}
            {copied ? "Copied" : "Copy"}
          </Button>
          {memories.length > 0 && (
            <details className="used-memories">
              <summary>
                <Brain size={12} />
                Used {memories.length} memories
              </summary>
              <ul>
                {memories.map((m: any) => (
                  <li key={m.id}>
                    {m.text}
                    {m.scope !== "global" ? ` (${m.scope.slice(7)})` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {copyError && <span role="alert">{copyError}</span>}
        </div>
      )}
    </article>
  );
}
