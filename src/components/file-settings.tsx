import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { Button } from "./ui/button";
import { clearFileChanges } from "@/lib/files/changes";
import {
  inspectWorkspacePermissions,
  requestWorkspacePermission,
  type WorkspacePermissions,
} from "@/lib/files/permissions";
import {
  clearBackups,
  connectWorkspace,
  disconnectWorkspace,
  getWorkspace,
  listBackups,
  type Backup,
  type Directory,
  type Workspace,
} from "@/lib/files/workspace";

export function FileSettings() {
  const [workspace, setWorkspace] = useState<Workspace>(),
    [permissions, setPermissions] = useState<WorkspacePermissions>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [backups, setBackups] = useState<Backup[]>([]);
  const refresh = async () => {
    const w = await getWorkspace();
    setWorkspace(w);
    setPermissions(w ? await inspectWorkspacePermissions(w.handle) : undefined);
    setBackups(await listBackups());
  };
  useEffect(() => {
    const update = () => void refresh().catch((e) => setError(String(e)));
    update();
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);
  const name = workspace?.handle.name ?? "";
  const reauthorize = async () => {
    if (!workspace) return;
    setError("");
    setBusy(true);
    try {
      // Already-loaded handle; call before any await to preserve the click.
      const state = await requestWorkspacePermission(workspace.handle);
      if (state !== "granted")
        setError(
          `Chrome did not grant read/write permission (${state}). The folder is still connected. Use Open AMA in tab, open Settings → Tools → Files, then click Reauthorize or choose the same folder again and accept Chrome's prompt.`,
        );
      await refresh();
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : String(e)}. Open AMA in tab and reauthorize there; Chrome requires a direct user click.`,
      );
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    setError("");
    try {
      const picker = (
        window as unknown as {
          showDirectoryPicker?: (o: { mode: string }) => Promise<Directory>;
        }
      ).showDirectoryPicker;
      if (!picker)
        throw new Error(
          "Directory picker unavailable. Open AMA in a Chrome extension tab and try again.",
        );
      // Must be invoked synchronously from this user gesture, before any await.
      const handle = await picker.call(window, { mode: "readwrite" });
      await connectWorkspace(handle);
      const state = await inspectWorkspacePermissions(handle);
      if (state.readwrite !== "granted")
        setError(
          `Folder connected, but Chrome read/write permission is ${state.readwrite}. Click Reauthorize and accept Chrome's prompt.`,
        );
      await refresh();
    } catch (e) {
      if ((e as DOMException).name !== "AbortError")
        setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className="card" aria-label="Local workspace files">
      <h2>Files</h2>
      <p className="hint">
        Default file tools operate only inside the folder you choose.
        Read/search runs automatically; create, edit, patch and delete always
        require a diff approval. Choose a narrow project folder, not your home
        directory.
      </p>
      <p>
        <strong>Workspace: {name || "Not connected"}</strong>
        {name &&
          ` · Read: ${permissions?.read ?? "checking"} · Write: ${permissions?.readwrite ?? "checking"}`}
      </p>
      <div className="row">
        <Button variant="outline" onClick={() => void choose()}>
          Choose workspace
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            void browser.tabs.create({
              url: browser.runtime.getURL("/sidepanel.html"),
            })
          }
        >
          Open AMA in tab
        </Button>
        {name && (
          <Button
            variant="outline"
            disabled={busy || !permissions}
            onClick={() => void reauthorize()}
          >
            Reauthorize
          </Button>
        )}
        {name && (
          <Button
            variant="ghost"
            onClick={() =>
              void disconnectWorkspace()
                .then(refresh)
                .catch((e) => setError(String(e)))
            }
          >
            Disconnect
          </Button>
        )}
      </div>
      {name && permissions && permissions.readwrite !== "granted" && (
        <p role="status">
          Folder connected; Chrome authorization is required, not another tool
          retry. Click Reauthorize and accept the browser prompt. If it does not
          appear, use Open AMA in tab and reauthorize there.
        </p>
      )}
      <p className="hint">
        Read text and search excerpts are sent to your configured model
        provider. UTF-8 only, 1 MiB/file. Sensitive filenames and root
        .gitignore paths are blocked; this is not a secret scanner. No recursive
        deletion or automatic directory creation. Permission may need renewal
        after restarting Chrome.
      </p>
      <details>
        <summary>Local recovery backups ({backups.length}/20)</summary>
        <p className="hint">
          Original text is saved before edits/deletes. Backups persist after
          disconnect; older ones rotate out. Download to recover manually. Files
          are not encrypted by AMA.
        </p>
        {backups.map((b) => (
          <div className="row" key={b.id}>
            <span>
              {b.workspace}/{b.path} · {new Date(b.at).toLocaleString()}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([b.text], { type: "text/plain;charset=utf-8" }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = b.path.split("/").at(-1) ?? "backup.txt";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download backup
            </Button>
          </div>
        ))}
        {backups.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (
                window.confirm("Permanently clear all local recovery backups?")
              )
                void clearBackups()
                  .then(refresh)
                  .catch((e) => setError(String(e)));
            }}
          >
            Clear backups
          </Button>
        )}
      </details>
      <details>
        <summary>Chat file previews</summary>
        <p className="hint">
          Before/after text is saved locally for reply previews (latest 100
          operations, up to 30 MiB of UTF-8 text). Snapshots persist after
          disconnect and are not encrypted. Clearing them does not change disk
          files, recovery backups or chat text.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (window.confirm("Clear all saved chat file previews?"))
              void clearFileChanges()
                .then(() => setError(""))
                .catch((e) => setError(String(e)));
          }}
        >
          Clear file previews
        </Button>
      </details>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
