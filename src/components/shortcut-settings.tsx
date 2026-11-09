import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { Button } from "./ui/button";

/** Chrome owns installed bindings; a suggested manifest key cannot reset them. */
export function ShortcutSettings() {
  const [binding, setBinding] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void browser.commands
        .getAll()
        .then((commands) => {
          if (alive) {
            setBinding(
              commands.find((c) => c.name === "toggle-panel")?.shortcut ||
                "Not assigned",
            );
            setError("");
          }
        })
        .catch(() => {
          if (alive) setError("Could not read Chrome's shortcut binding.");
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return (
    <section>
      <h2>Panel shortcut</h2>
      <p className="hint" role="status">
        Current browser binding: <strong>{binding ?? "Checking…"}</strong>
      </p>
      <p className="hint">
        Suggested: ⌘K on macOS, Ctrl+K on Windows/Linux. Existing installations
        may retain an older key or no binding. Open Chrome's shortcut settings,
        find AMA → Toggle the AMA side panel and record your preferred key.
        Remove conflicting extension bindings if needed. Reloading AMA alone
        does not reset it; do not uninstall.
      </p>
      <Button
        variant="outline"
        onClick={() =>
          void browser.tabs
            .create({ url: "chrome://extensions/shortcuts" })
            .catch(() =>
              setError(
                "Open chrome://extensions/shortcuts manually in the address bar.",
              ),
            )
        }
      >
        Configure browser shortcuts
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
