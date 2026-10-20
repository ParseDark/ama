import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  getConfigSyncState,
  SYNC_STATE_KEY,
  type ConfigSyncAction,
  type ConfigSyncState,
} from "@/lib/config-sync";
import { Button } from "./ui/button";

export function ConfigSyncSettings() {
  const [state, setState] = useState<ConfigSyncState>({ enabled: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void getConfigSyncState().then((s) => {
        if (live) setState(s);
      });
    refresh();
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && changes[SYNC_STATE_KEY]) refresh();
    };
    browser.storage.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.onChanged.removeListener(listener);
    };
  }, []);
  const run = async (action: ConfigSyncAction) => {
    const questions: Partial<Record<ConfigSyncAction, string>> = {
      "enable-upload":
        "Enable Chrome sync and replace cloud configuration with ALL this device's settings, including API keys, DeepSeek search keys, MCP tokens and headers? AMA adds no encryption. History and files stay local.",
      "enable-download":
        "Enable Chrome sync and replace ALL this device's configuration and credentials with the cloud snapshot? History and files stay local.",
      upload:
        "Replace cloud configuration with all settings and credentials from this device?",
      download:
        "Replace all local settings and credentials with the cloud snapshot?",
      "clear-cloud":
        "Remove AMA configuration and credentials from Chrome sync? Disable sync on your other devices first, or they can upload again. Local settings are retained.",
    };
    if (questions[action] && !confirm(questions[action])) return;
    setBusy(true);
    setError("");
    try {
      const result = await browser.runtime.sendMessage({
        type: "ama:config-sync",
        action,
      });
      if (!result?.ok)
        setError(
          result?.error ??
            "Sync request failed. Reload the extension and retry.",
        );
      setState(await getConfigSyncState());
    } catch {
      setError(
        "Sync request failed. Reload the extension and retry. Local settings are retained.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-label="Configuration sync">
      <h2>Chrome configuration sync</h2>
      <p className="hint">
        Optional, off by default. Syncs ALL provider, model list, embedding, web
        search and MCP configuration, including API keys, tokens, custom headers
        the memory enable switch and Danger mode. A cloud download can enable
        Danger mode on this device. Requires the same extension ID, Chrome
        account and extension sync on each device. No AMA account or backend.
      </p>
      <p className="hint">
        Credentials leave this device through Chrome sync. AMA does not add
        encryption or provide a secret vault. Only enable this on trusted Chrome
        profiles. History, memory text, images, file previews, workspace handles
        and permissions stay local.
      </p>
      <p role="status">
        {state.enabled ? "Enabled on this device" : "Disabled on this device"}
        {state.pending ? " · Changes pending" : ""}
      </p>
      <p className="hint">
        {state.lastUploadAt
          ? `Last upload: ${new Date(state.lastUploadAt).toLocaleString()}. `
          : ""}
        {state.lastDownloadAt
          ? `Last download: ${new Date(state.lastDownloadAt).toLocaleString()}.`
          : ""}
        These are local Chrome storage operations, not proof another device has
        received the data.
      </p>
      <div className="row config-sync-actions">
        {!state.enabled ? (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run("enable-upload")}
            >
              Enable · upload this device
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run("enable-download")}
            >
              Enable · use cloud config
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run("upload")}
            >
              Upload this device
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run("download")}
            >
              Use cloud config
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run("disable")}
            >
              Disable sync
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          disabled={busy || state.enabled}
          onClick={() => void run("clear-cloud")}
        >
          Clear cloud config
        </Button>
      </div>
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
      <p className="hint">
        Changes upload after a short debounce. Conflicts use the latest recorded
        whole-configuration revision (device clock, then ID); not field merging.
        Offline or concurrent edits can overwrite another device. First-time
        upload/download is explicit. Disabling retains local and cloud copies;
        clear cloud separately. Large configurations may exceed Chrome quotas
        and stay local with an error—nothing is silently omitted.
      </p>
    </section>
  );
}
