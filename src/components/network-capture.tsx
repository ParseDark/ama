import { useEffect, useState } from "react";
import { networkClient } from "@/lib/network/client";
import { Button } from "./ui/button";

type CaptureStatus = Awaited<ReturnType<typeof networkClient.status>>;

export const NETWORK_PRIVACY =
  "Capturing reads the current page's network requests and responses. Headers, URLs and bodies may contain sensitive information and are not redacted. A preview may be sent to the selected model. Starting capture does not upload traffic by itself, and does not refresh the page.";

export function NetworkCapture({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let live = true;
    // Pushes deliberately carry no session identity. Re-query using this chat's
    // authorization rather than displaying another chat's status.
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void networkClient.status(sessionId).then(
        (value) => {
          if (live && current === revision) {
            setStatus(value);
            setError("");
          }
        },
        (e) => {
          if (live && current === revision) {
            setStatus(null);
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      );
    };
    const listener = (message: unknown) => {
      if ((message as { type?: string })?.type === "network-capture-status")
        refresh();
    };
    browser.runtime.onMessage.addListener(listener);
    refresh();
    return () => {
      live = false;
      browser.runtime.onMessage.removeListener(listener);
    };
  }, [sessionId]);
  const run = async (start: boolean) => {
    setPending(true);
    setError("");
    try {
      if (start) await networkClient.start(sessionId);
      else await networkClient.stop(sessionId);
      setStatus(await networkClient.status(sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const labels = {
    stopped: "Stopped",
    starting: "Starting",
    capturing: "Capturing",
    stopping: "Stopping",
  } as const;
  return (
    <section aria-label="Network capture" className="network-capture">
      <p className="hint">{NETWORK_PRIVACY}</p>
      <div className="row">
        <strong>
          Network: {status ? labels[status.state] : "Unavailable"}
        </strong>
        <Button
          size="sm"
          variant="outline"
          disabled={
            pending ||
            !status ||
            status.state === "starting" ||
            status.state === "stopping"
          }
          onClick={() => void run(status?.state !== "capturing")}
        >
          {status?.state === "capturing" ? "Stop capture" : "Start capture"}
        </Button>
      </div>
      {status && (
        <p className="hint" role="status">
          {status.count} requests
          {status.tabId != null ? ` · Tab ${status.tabId}` : ""}
          {status.limitReached
            ? ` · Limit reached (200); ${status.droppedCount} dropped`
            : ""}
          {status.reason ? ` · ${status.reason}` : ""}
          {status.error ? ` · ${status.error}` : ""}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
