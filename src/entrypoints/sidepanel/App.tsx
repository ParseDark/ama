import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { useSettings } from "@/hooks/use-settings";
import { getConfigProblem, getFontScale } from "@/lib/settings";
import { applyFontScale } from "@/lib/font-scale";
import { activeSessionStore, loadSession, sessionsStore } from "@/lib/sessions";
import { categorizeStoredMemories } from "@/lib/memory/classify";
import { runLearning } from "@/lib/memory/learning";
import { ChatView } from "@/components/chat-view";
import { SettingsView } from "@/components/settings-view";
import { HistoryView } from "@/components/history-view";
import { MemoryView } from "@/components/memory-view";
import { networkClient } from "@/lib/network/client";
export default function App() {
  const { settings, setSettings, loaded } = useSettings(),
    fontScale = getFontScale(settings),
    [view, setView] = useState<"chat" | "settings" | "history" | "memory">(
      "chat",
    ),
    [tab, setTab] = useState("model"),
    [session, setSession] = useState<{
      id: string;
      messages: UIMessage[];
    } | null>(null),
    initialized = useRef(false),
    switchVersion = useRef(0),
    [switchError, setSwitchError] = useState("");
  useEffect(() => {
    applyFontScale(fontScale);
  }, [fontScale]);
  useEffect(() => {
    if (!loaded || initialized.current) return;
    initialized.current = true;
    if (getConfigProblem(settings)) setView("settings");
    void (async () => {
      const id = await activeSessionStore.getValue(),
        sessions = await sessionsStore.getValue();
      setSession(
        id && sessions.some((s) => s.id === id)
          ? { id, messages: await loadSession(id) }
          : { id: crypto.randomUUID(), messages: [] },
      );
      void categorizeStoredMemories();
      // Learning may have missed earlier chats after a bad structured-answer
      // upgrade; opening the panel gives it a chance to catch up.
      void runLearning();
    })();
  }, [loaded, settings]);
  const switchSession = (id: string | null) => {
    if (!session) return;
    const version = ++switchVersion.current;
    setSwitchError("");
    const report = (operation: string, e: unknown) =>
      setSwitchError(
        `${operation}: ${e instanceof Error ? e.message : String(e)}`,
      );
    if (id !== session.id) {
      void (async () => {
        try {
          const capture = await networkClient.status(session.id);
          if (capture.state !== "stopped") await networkClient.stop(session.id);
        } catch (e) {
          if (
            !(e instanceof Error) ||
            e.message !== "Capture belongs to another session"
          )
            report("Could not stop network capture", e);
        }
      })();
    }
    const show = (next: { id: string; messages: UIMessage[] }) => {
      if (version !== switchVersion.current) return;
      setSession(next);
      setView("chat");
      void activeSessionStore
        .setValue(id)
        .catch((e) => report("Could not save active chat", e));
      void runLearning();
    };
    if (id) {
      void loadSession(id)
        .then((messages) => show({ id, messages }))
        .catch((e) => report("Could not switch chats", e));
    } else {
      show({ id: crypto.randomUUID(), messages: [] });
    }
  };
  const openSession = (id: string) => void switchSession(id);
  const newChat = () => void switchSession(null);
  if (!session) return <div className="loading">Opening AMA…</div>;
  return (
    <>
      {switchError && <p role="alert">{switchError}</p>}
      <div hidden={view !== "chat"} className="chat-container">
        <ChatView
          key={session.id}
          id={session.id}
          active={view === "chat"}
          initialMessages={session.messages}
          settings={settings}
          onSettingsChange={setSettings}
          onNew={newChat}
          onClearError={(e) =>
            setSwitchError(
              `Could not clear chat: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
          onSettings={() => setView("settings")}
          onHistory={() => setView("history")}
        />
      </div>
      {view === "settings" && (
        <SettingsView
          settings={settings}
          onChange={setSettings}
          tab={tab}
          onTab={setTab}
          onBack={() => setView("chat")}
          onMemory={() => setView("memory")}
        />
      )}{" "}
      {view === "history" && (
        <HistoryView
          settings={settings}
          onBack={() => setView("chat")}
          onOpen={openSession}
          onDeleted={(id) => {
            if (id === session.id) {
              setSession({ id: crypto.randomUUID(), messages: [] });
              setView("chat");
            }
          }}
        />
      )}{" "}
      {view === "memory" && (
        <MemoryView
          settings={settings}
          onBack={() => {
            setTab("memory");
            setView("settings");
          }}
        />
      )}
    </>
  );
}
