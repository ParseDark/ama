import { useEffect, useState } from "react";
import { FileText, X, Download } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import {
  changedFiles,
  loadFileChange,
  netFileAction,
  previewDiff,
  type ChangedFile,
} from "@/lib/files/changes";
import type { UIMessage } from "ai";
import { Button } from "./ui/button";

const DISPLAY_LIMIT = 100000;
type Preview = {
  before: string | null;
  after: string | null;
  diff: string;
  partial: boolean;
};
export function FileChanges({ message }: { message: UIMessage }) {
  const files = changedFiles(message);
  const [selected, setSelected] = useState<ChangedFile | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"after" | "before" | "diff">("after");
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setPreview(null);
    setError("");
    void Promise.all(selected.receipts.map(loadFileChange))
      .then((snapshots) => {
        if (cancelled) return;
        const first = snapshots[0],
          last = snapshots.at(-1);
        if (!first || !last) {
          setError(
            "Saved preview unavailable or expired. The file operation succeeded, but its local snapshot is no longer available. This view does not reread your disk.",
          );
          return;
        }
        const before = first.before,
          after = last.after;
        setPreview({
          before,
          after,
          diff: previewDiff(before, after, selected.path),
          partial: snapshots.some((s) => !s),
        });
        setTab(after === null ? "before" : "after");
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the local file preview.");
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);
  if (!files.length) return null;
  const content = preview
    ? tab === "diff"
      ? preview.diff
      : tab === "before"
        ? preview.before
        : preview.after
    : null;
  return (
    <section className="file-changes" aria-label="Changed files">
      <strong>
        {files.length} file{files.length === 1 ? "" : "s"} changed
      </strong>
      <ul>
        {files.map((file) => (
          <li key={file.key}>
            <Button
              variant="ghost"
              size="sm"
              className="changed-file-button"
              onClick={() => setSelected(file)}
              aria-label={`Preview ${file.path}`}
            >
              <FileText size={14} />
              <span>{file.path}</span>
              <small>
                {file.receipts.length > 1
                  ? `${file.receipts.length} operations`
                  : {
                      create: "Created",
                      edit: "Modified",
                      patch: "Patched",
                      delete: "Deleted",
                    }[file.receipts[0].action]}
              </small>
            </Button>
            <span className="file-workspace">{file.workspace}</span>
          </li>
        ))}
      </ul>
      <Dialog.Root
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="file-preview-backdrop" />
          <Dialog.Popup className="file-preview" aria-label="File preview">
            <div className="file-preview-header">
              <Dialog.Title>{selected?.path}</Dialog.Title>
              <Dialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close file preview"
                  />
                }
              >
                <X size={16} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="hint">
              {selected?.workspace} · Saved snapshot from this reply, not the
              current disk file. Text is displayed literally; HTML/scripts are
              never executed.
            </Dialog.Description>
            {preview ? (
              <>
                <div className="file-preview-actions">
                  <span>{netFileAction(preview.before, preview.after)}</span>
                  {(["after", "before", "diff"] as const).map((t) => (
                    <Button
                      key={t}
                      size="sm"
                      variant={tab === t ? "secondary" : "ghost"}
                      aria-pressed={tab === t}
                      onClick={() => setTab(t)}
                    >
                      {t === "after"
                        ? "After"
                        : t === "before"
                          ? "Before"
                          : "Diff"}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={content === null}
                    onClick={() => {
                      if (content === null || !selected) return;
                      const url = URL.createObjectURL(
                        new Blob([content], {
                          type: "text/plain;charset=utf-8",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download =
                        (selected.path.split("/").at(-1) ?? "file") +
                        (tab === "diff" ? ".patch" : "");
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    <Download size={13} />
                    Download
                  </Button>
                </div>
                {preview.partial && (
                  <p role="status">
                    Some intermediate snapshots expired; showing the first and
                    last available endpoints.
                  </p>
                )}
                {content !== null && content.length > DISPLAY_LIMIT && (
                  <p role="status">
                    Preview truncated to {DISPLAY_LIMIT.toLocaleString()}{" "}
                    characters. Download contains the full saved text.
                  </p>
                )}
                <pre
                  className="file-preview-content"
                  aria-label="File preview content"
                >
                  {content === null
                    ? tab === "before"
                      ? "File did not exist before this reply."
                      : "File was deleted."
                    : content.length === 0
                      ? "(empty file)"
                      : content.slice(0, DISPLAY_LIMIT)}
                </pre>
              </>
            ) : error ? (
              <p role="alert">{error}</p>
            ) : (
              <p role="status">Loading local snapshot…</p>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
