import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import {
  Globe,
  Trash2,
  Plus,
  History,
  Settings as SettingsIcon,
  Camera,
  ArrowUp,
  Square,
  X,
  Sparkles,
} from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { LocalChatTransport } from "@/lib/local-chat-transport";
import { saveSession, deleteSession } from "@/lib/sessions";
import { captureActiveTab } from "@/lib/active-tab";
import { captureFullPage } from "@/lib/full-page-capture";
import { logMemoryEvent } from "@/lib/memory/store";
import { runLearning } from "@/lib/memory/learning";
import { isReadyToSuggest } from "@/lib/memory/merger";
import { useMemory } from "@/hooks/use-memory";
import { useActiveTab } from "@/hooks/use-active-tab";
import { useComposerFocus } from "@/hooks/use-composer-focus";
import { hostnameOf } from "@/lib/url";
import type { Settings } from "@/lib/settings";
import { updateSettings } from "@/lib/settings";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";
import { ModelPicker } from "./model-picker";
import { ChatMessage } from "./chat-message";
import { MemorySuggestion } from "./memory-suggestion";
import { ContextMeter, currentModelInfo, lastUsage } from "./context-meter";
export function ChatView({
  id,
  initialMessages,
  settings,
  active = true,
  onSettingsChange,
  onNew,
  onClearError,
  onHistory,
  onSettings,
}: {
  id: string;
  initialMessages: UIMessage[];
  settings: Settings;
  active?: boolean;
  onSettingsChange: (s: Settings) => void;
  onNew: () => void;
  onClearError: (error: unknown) => void;
  onHistory: () => void;
  onSettings: () => void;
}) {
  const transport = useMemo(
    () =>
      new LocalChatTransport({
        saveSettings: async (s) => {
          await updateSettings(() => s);
        },
      }),
    [],
  );
  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    setMessages,
    regenerate,
    addToolApprovalResponse,
  } = useChat({
    id,
    messages: initialMessages,
    transport,
    onFinish: ({ message, isAbort, isError, isDisconnect }) => {
      // useChat may cancel stream consumption before transport abort metadata is
      // delivered. Finalize locally so stopped/error history never claims success.
      if (!isAbort && !isError && !isDisconnect) return;
      const generationStats = transport.interruptStats(
        id,
        isAbort ? "stopped" : "error",
      );
      if (!generationStats) return;
      setMessages((current) =>
        current.map((m) =>
          m.id === message.id
            ? { ...m, metadata: { ...(m.metadata as object), generationStats } }
            : m,
        ),
      );
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const tab = useActiveTab(),
    domain = hostnameOf(tab?.url),
    { memories, enabled } = useMemory();
  const [text, setText] = useState(""),
    [images, setImages] = useState<string[]>([]),
    [captureError, setCaptureError] = useState(""),
    [capturing, setCapturing] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  useComposerFocus(composer, active);
  const end = useRef<HTMLDivElement>(null),
    busy = status === "submitted" || status === "streaming",
    clearing = useRef(false);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);
  useEffect(() => {
    if (!busy && !clearing.current && messages.length)
      void saveSession(id, messages);
  }, [messages, busy, id]);
  useEffect(() => {
    if (status !== "ready") return;
    const timer = setTimeout(() => void runLearning(), 300000);
    return () => clearTimeout(timer);
  }, [status, messages]);
  // Remount first so a user who types immediately lands in the new chat. The
  // old ID is tombstoned afterwards; a running tool cannot resurrect its data.
  const clear = useCallback(() => {
    clearing.current = true;
    stop();
    setMessages([]);
    setImages([]);
    setCaptureError("");
    onNew();
    void deleteSession(id).catch(onClearError);
  }, [id, stop, setMessages, onNew, onClearError]);
  useEffect(() => {
    const fn = () => void clear();
    window.addEventListener("ama:clear-chat", fn);
    return () => window.removeEventListener("ama:clear-chat", fn);
  }, [clear]);
  const send = (value = text) => {
    if (busy || (!value.trim() && !images.length)) return;
    const content =
      value.trim() ||
      (images.length ? "What is shown in this screenshot?" : "");
    void sendMessage({
      text: content,
      files: images.map((url) => ({
        type: "file" as const,
        mediaType: "image/jpeg",
        url,
      })),
      metadata: { domain, incognito: tab?.incognito ?? false },
    });
    setText("");
    setImages([]);
  };
  const attach = async (full: boolean) => {
    setCapturing(true);
    setCaptureError("");
    try {
      const image = await (full ? captureFullPage() : captureActiveTab());
      setImages((v) => [...v, image]);
    } catch (e) {
      setCaptureError(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  };
  const suggestion = enabled
    ? memories.find(
        (m) =>
          isReadyToSuggest(m) &&
          (m.scope === "global" || m.scope === `domain:${domain}`),
      )
    : undefined;
  return (
    <div className="chat-view">
      <header className="chat-header">
        <div className="page-badge" title={tab?.url}>
          {tab?.favIconUrl ? (
            <img src={tab.favIconUrl} alt="" />
          ) : (
            <Globe size={15} />
          )}
          <span>{tab?.title ?? "Current page"}</span>
        </div>
        <div className="row header-actions">
          <Tooltip label="Clear chat (⌥⇧L)">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear chat (⌥⇧L)"
              onClick={() => void clear()}
            >
              <Trash2 size={16} />
            </Button>
          </Tooltip>
          <Tooltip label="New chat">
            <Button
              variant="ghost"
              size="icon"
              aria-label="New chat"
              onClick={onNew}
            >
              <Plus size={18} />
            </Button>
          </Tooltip>
          <Tooltip label="Chats">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Chats"
              onClick={onHistory}
            >
              <History size={17} />
            </Button>
          </Tooltip>
          <Tooltip label="Settings">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Settings"
              onClick={onSettings}
            >
              <SettingsIcon size={17} />
            </Button>
          </Tooltip>
        </div>
      </header>
      <main className="message-scroller">
        {settings.dangerMode === true && (
          <p className="hint" role="status">
            Danger mode ON · Memory and browser actions run without approval.
          </p>
        )}
        {messages.length ? (
          messages.map((m, i) => (
            <ChatMessage
              key={m.id}
              message={m}
              streaming={
                busy && i === messages.length - 1 && m.role === "assistant"
              }
              onApproval={(v) => void addToolApprovalResponse(v)}
            />
          ))
        ) : (
          <div className="chat-empty">
            <div className="ama-mark">
              <Sparkles size={26} />
            </div>
            <span className="eyebrow">A LITTLE MORE CONTEXT</span>
            <h1>Ask about this page</h1>
            <p>
              The current tab is read as Markdown each time you send a message.
            </p>
            <div className="suggestions">
              {[
                "总结一下这个页面",
                "What are the key points?",
                "这个项目是做什么的？怎么上手？",
              ].map((t) => (
                <button key={t} onClick={() => send(t)}>
                  {t}
                  <ArrowUp size={13} />
                </button>
              ))}
            </div>
          </div>
        )}
        {status === "submitted" && <p className="reading">Reading page…</p>}
        <div ref={end} />
      </main>
      <div className="composer-area">
        {suggestion && <MemorySuggestion memory={suggestion} />}{" "}
        {(error || captureError) && (
          <div className="alert" role="alert">
            {captureError || error?.message}
            {error && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void regenerate()}
              >
                Retry
              </Button>
            )}
          </div>
        )}
        <div className="composer">
          {images.length > 0 && (
            <div className="attachments">
              {images.map((url, i) => (
                <div key={i}>
                  <img src={url} alt={`Screenshot ${i + 1}`} />
                  <button
                    aria-label={`Remove screenshot ${i + 1}`}
                    onClick={() =>
                      setImages((v) => v.filter((_, n) => n !== i))
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={composer}
            aria-label="Message"
            placeholder="Ask anything about this page…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-toolbar">
            <Menu.Root>
              <Menu.Trigger
                className="camera-button"
                aria-label="Attach screenshot"
                disabled={capturing}
              >
                <Camera size={17} />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner side="top" sideOffset={8}>
                  <Menu.Popup className="menu-popup">
                    <Menu.Item onClick={() => void attach(false)}>
                      Visible area
                    </Menu.Item>
                    <Menu.Item onClick={() => void attach(true)}>
                      Full page
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
            <ModelPicker settings={settings} onChange={onSettingsChange} />
            <span className="spacer" />
            <ContextMeter
              usage={lastUsage(messages)}
              info={currentModelInfo(settings)}
              infoFetched={
                settings.providers[settings.provider]?.modelInfo !== undefined
              }
            />
            {busy ? (
              <Button
                size="icon"
                aria-label="Stop"
                onClick={() => {
                  stop();
                  if (!tab?.incognito)
                    void logMemoryEvent({
                      ts: Date.now(),
                      type: "stop",
                      domain,
                      sessionId: id,
                    });
                }}
              >
                <Square size={14} />
              </Button>
            ) : (
              <Button
                size="icon"
                aria-label="Send"
                disabled={capturing || (!text.trim() && !images.length)}
                onClick={() => send()}
              >
                <ArrowUp size={17} />
              </Button>
            )}
          </div>
        </div>
        <div className="composer-hint">
          Page context, not guesswork. <kbd>↵</kbd> to send
        </div>
      </div>
    </div>
  );
}
