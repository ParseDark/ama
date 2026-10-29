import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Trash2,
  MessageSquare,
  Search,
  Loader2,
} from "lucide-react";
import {
  sessionsStore,
  deleteSession,
  type SessionSummary,
} from "@/lib/sessions";
import { searchHistory, type Exchange } from "@/lib/history-search";
import { getEmbeddingConfig, type Settings } from "@/lib/settings";
import { Button } from "./ui/button";
export function relativeTime(ts: number) {
  const d = Math.max(0, Date.now() - ts);
  return d < 60000
    ? "Just now"
    : d < 3600000
      ? `${Math.floor(d / 60000)}m ago`
      : d < 86400000
        ? `${Math.floor(d / 3600000)}h ago`
        : new Date(ts).toLocaleDateString();
}
export function HistoryView({
  settings,
  onBack,
  onOpen,
  onDeleted,
}: {
  settings: Settings;
  onBack: () => void;
  onOpen: (id: string) => void;
  onDeleted?: (id: string) => void;
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<Exchange[]>([]),
    [busy, setBusy] = useState(false),
    [deleteError, setDeleteError] = useState("");
  useEffect(() => {
    void sessionsStore.getValue().then(setSessions);
    return sessionsStore.watch(setSessions);
  }, []);
  useEffect(() => {
    if (!query.trim()) {
      setBusy(false);
      setHits([]);
      return;
    }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      void searchHistory(query, { config: getEmbeddingConfig(settings) }).then(
        (h) => {
          if (live) {
            setHits(h);
            setBusy(false);
          }
        },
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, settings]);
  return (
    <div className="view">
      <header>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Back to chat"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </Button>
        <h1>Chats</h1>
        <span className="badge">{sessions.length}</span>
      </header>
      <div className="settings-body">
        {deleteError && <p role="alert">{deleteError}</p>}
        {sessions.length > 0 && (
          <div className="search-field">
            <Search size={15} />
            <input
              aria-label="Search chats"
              placeholder={'Search by meaning, e.g. "the Kafka retry plan"'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {busy && <Loader2 className="spin" size={15} />}
          </div>
        )}
        {query.trim() ? (
          <div aria-label="Search results">
            {hits.map((h) => (
              <button
                className="history-hit"
                key={h.id}
                onClick={() => onOpen(h.sessionId)}
              >
                <strong>{h.sessionTitle}</strong>
                <p>{h.question}</p>
                <p className="hint">{h.answer}</p>
                <small>{relativeTime(h.updatedAt)}</small>
              </button>
            ))}
            {!busy && !hits.length && (
              <p className="empty-small">No earlier chat matches.</p>
            )}
          </div>
        ) : sessions.length ? (
          <ul className="history-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <button onClick={() => onOpen(s.id)}>
                  <MessageSquare size={16} />
                  <span>
                    <strong>{s.title}</strong>
                    <small>{relativeTime(s.updatedAt)}</small>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete chat ${s.title}`}
                  onClick={() => {
                    setDeleteError("");
                    void deleteSession(s.id)
                      .then(() => onDeleted?.(s.id))
                      .catch((e) =>
                        setDeleteError(
                          `Could not delete chat: ${e instanceof Error ? e.message : String(e)}`,
                        ),
                      );
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-small">
            Your conversations will appear here.
          </div>
        )}
      </div>
    </div>
  );
}
