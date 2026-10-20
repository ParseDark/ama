import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { useSettings } from "@/hooks/use-settings";
import { getConfigProblem } from "@/lib/settings";
import { activeSessionStore, loadSession, sessionsStore } from "@/lib/sessions";
import { categorizeStoredMemories } from "@/lib/memory/classify";
import { runLearning } from "@/lib/memory/learning";
import { ChatView } from "@/components/chat-view";
import { SettingsView } from "@/components/settings-view";
import { HistoryView } from "@/components/history-view";
import { MemoryView } from "@/components/memory-view";
export default function App() {
  const { settings, setSettings, loaded } = useSettings(),
    [view, setView] = useState<"chat" | "settings" | "history" | "memory">(
      "chat",
    ),
    [tab, setTab] = useState("model"),
    [session, setSession] = useState<{
      id: string;
      messages: UIMessage[];
    } | null>(null),
    initialized = useRef(false);
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
  const openSession = async (id: string) => {
    void runLearning();
    await activeSessionStore.setValue(id);
    setSession({ id, messages: await loadSession(id) });
    setView("chat");
  };
  const newChat = () => {
    void runLearning();
    void activeSessionStore.setValue(null);
    setSession({ id: crypto.randomUUID(), messages: [] });
    setView("chat");
  };
  if (!session) return <div className="loading">Opening AMA…</div>;
  return (
    <>
      <div hidden={view !== "chat"} className="chat-container">
        <ChatView
          key={session.id}
          id={session.id}
          active={view === "chat"}
          initialMessages={session.messages}
          settings={settings}
          onSettingsChange={setSettings}
          onNew={newChat}
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
          onOpen={(id) => void openSession(id)}
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
