import { useEffect } from "react";
import {
  Brain,
  MapPin,
  Loader2,
  Check,
  AlertTriangle,
  Circle,
  ExternalLink,
  Settings,
} from "lucide-react";
import { getApprovalDetails } from "@/lib/page-tools";
import { FILE_TOOLS } from "@/lib/files/workspace";
import { getFilePreview, discardFilePreview } from "@/lib/files/tools";
import { getMemoryApprovalReason } from "@/lib/memory/tools";
import { getMcpToolInfo } from "@/lib/mcp-tools";
import { SETTINGS_TOOLS, describeSettingsChange } from "@/lib/settings-tools";
import { undoRemember } from "@/lib/memory/store";
import { runInTab } from "@/lib/active-tab";
import { highlightElement } from "@/lib/highlight";
import { switchTab } from "@/lib/tabs";
import { Button } from "./ui/button";
import { WebToolPart } from "./web-tool-part";
import { WEB_TOOLS } from "@/lib/web-search/tools";
import { useActiveTab } from "@/hooks/use-active-tab";
import { NETWORK_PRIVACY } from "./network-capture";
function NetworkApproval({
  part,
  onApproval,
}: {
  part: any;
  onApproval: (v: { id: string; approved: boolean }) => void;
}) {
  const tab = useActiveTab();
  return (
    <div className="approval-card" role="group" aria-label="Approval required">
      <strong>
        Capture network traffic on the current page
        {tab?.title ? `: ${tab.title}` : ""}?
      </strong>
      <p>{NETWORK_PRIVACY} The current tab is selected when capture starts.</p>
      <div className="row">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onApproval({ id: part.approval.id, approved: false })}
        >
          Deny
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onApproval({ id: part.approval.id, approved: true })}
        >
          Allow
        </Button>
      </div>
    </div>
  );
}
export function PlanPart({ part }: { part: any }) {
  const steps = part.input?.steps ?? [];
  return (
    <div className="plan-card" role="group" aria-label="Plan">
      <strong>
        Plan · {steps.filter((s: any) => s.status === "done").length}/
        {steps.length}
      </strong>
      {steps.map((s: any, i: number) => (
        <div className={s.status === "done" ? "done" : ""} key={i}>
          {s.status === "done" ? (
            <Check size={14} />
          ) : s.status === "in_progress" ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <Circle size={14} />
          )}
          <span>{s.title}</span>
        </div>
      ))}
    </div>
  );
}
const builtins = new Set([
  ...FILE_TOOLS,
  ...WEB_TOOLS,
  ...SETTINGS_TOOLS,
  "highlight",
  "fill",
  "select",
  "check",
  "click",
  "read_tab",
  "open_tab",
  "list_tabs",
  "switch_tab",
  "close_tab",
  "remember",
  "forget",
  "recall_memory",
  "search_history",
  "plan",
  "capture_network_start",
  "capture_network_stop",
]);
export function ToolPart({
  part,
  onApproval,
}: {
  part: any;
  onApproval: (v: { id: string; approved: boolean }) => void;
}) {
  const name =
      part.type === "dynamic-tool" ? part.toolName : part.type.slice(5),
    input = part.input ?? {},
    out = part.output ?? {},
    details = getApprovalDetails(part.toolCallId),
    approval = part.state === "approval-requested",
    isMemory = ["remember", "forget", "recall_memory"].includes(name),
    isFile = FILE_TOOLS.includes(name),
    isSettings = (SETTINGS_TOOLS as readonly string[]).includes(name),
    filePreview = isFile ? getFilePreview(part.toolCallId) : undefined,
    isMcp = !builtins.has(name),
    info = getMcpToolInfo(name),
    tab = out.tabId ?? details?.tabId ?? input.tab;
  const pending = ![
    "output-available",
    "output-error",
    "output-denied",
  ].includes(part.state);
  useEffect(() => {
    if (approval && tab && input.id)
      void runInTab(tab, highlightElement, [
        input.id,
        "Waiting for your approval",
      ]).catch(() => {});
  }, [approval, tab, input.id]);
  if (name === "plan") return <PlanPart part={part} />;
  if (name === "web_search" || name === "web_fetch")
    return <WebToolPart part={part} name={name} />;
  if (isSettings)
    return <SettingsToolView part={part} name={name} onApproval={onApproval} />;
  if (approval && name === "capture_network_start")
    return <NetworkApproval part={part} onApproval={onApproval} />;
  if (approval) {
    let question = "",
      reason = "";
    if (name === "remember" || name === "forget") {
      question =
        name === "remember"
          ? `Save to memory: "${input.text}"?`
          : `Forget memories matching: ${input.query}?`;
      reason = getMemoryApprovalReason(part.toolCallId) ?? "";
    } else if (isFile) {
      question = filePreview
        ? `${filePreview.action} ${filePreview.workspace.handle.name}/${filePreview.path}?`
        : "File preview expired — deny and request a fresh preview.";
      reason =
        "Local file change. Review the complete diff below. External file changes will reject this operation. Deleted/edited originals are kept in local recovery backups (latest 20).";
    } else if (isMcp) {
      question = `Let ${info?.server ?? "server"} run ${info?.tool ?? name}?`;
      reason = "This tool may change data on the server.";
    } else {
      const where = details?.tabTitle ? ` in "${details.tabTitle}"` : "";
      question =
        name === "click"
          ? `Click ${details?.label ?? "this element"}${where}?`
          : name === "fill"
            ? `Type "${input.text}"${where}?`
            : name === "select"
              ? `Select "${input.option}"${where}?`
              : name === "check"
                ? `${input.checked ? "Check" : "Uncheck"} a box${where}?`
                : `Read the tab "${details?.tabTitle ?? tab}"?`;
      reason = [
        details?.tabTitle ? "You haven't shared this tab in this chat." : "",
        details?.submit
          ? "This looks like it submits or commits something on the page."
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    return (
      <div
        className={`approval-card ${isMemory ? "memory-approval" : ""}`}
        role="group"
        aria-label="Approval required"
      >
        <strong>{question}</strong>
        <p>{reason}</p>
        {isMcp && <pre>{JSON.stringify(input, null, 2).slice(0, 1200)}</pre>}
        {isFile && filePreview && (
          <pre className="file-diff" aria-label="File change preview">
            {filePreview.diff}
          </pre>
        )}
        <div className="row">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (isFile) discardFilePreview(part.toolCallId);
              onApproval({ id: part.approval.id, approved: false });
            }}
          >
            {isMemory ? (name === "forget" ? "Keep" : "Don't save") : "Deny"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isFile && !filePreview}
            onClick={() => onApproval({ id: part.approval.id, approved: true })}
          >
            {isMemory ? (name === "forget" ? "Forget" : "Save") : "Allow"}
          </Button>
        </div>
      </div>
    );
  }
  let label = "";
  if (part.state === "output-denied")
    label = `Skipped: ${name} ${details?.label ?? ""}`;
  else if (part.state === "output-error")
    label = part.errorText ?? "Tool failed";
  else if (isFile)
    label = `${name} · ${input.path ?? input.query ?? input.pattern ?? "workspace"}${pending ? "…" : ""}`;
  else if (isMcp) {
    label = `${info?.server ?? "MCP"} · ${info?.tool ?? name}`;
    if (out.isError)
      label += `: ${out.content?.find((c: any) => c.type === "text")?.text ?? "Error"}`;
  } else if (name === "remember")
    label = pending
      ? "Remembering…"
      : out.saved
        ? out.duplicate
          ? `Already remembered: ${out.text}`
          : `Remembered: ${out.text}${out.replaced?.length ? ` (replaces "${out.replaced.map((m: any) => m.text).join("; ")}")` : ""}`
        : `Not saved: ${out.reason}`;
  else if (name === "forget")
    label = pending
      ? "Forgetting…"
      : (out.error ??
        `Forgot: ${out.removed?.map((m: any) => m.text).join("; ")}`);
  else if (name === "recall_memory") label = "Looked up saved references";
  else if (name === "search_history") label = "Searched earlier chats";
  else if (name === "highlight")
    label = pending
      ? `Locating ${input.note}…`
      : out.found
        ? input.note
        : `Couldn't find "${input.note}" on the page`;
  else if (name === "fill") label = `Typed "${input.text}"`;
  else if (name === "select") label = `Selected "${input.option}"`;
  else if (name === "check") label = input.checked ? "Checked" : "Unchecked";
  else if (name === "click") label = `Clicked ${details?.label ?? "element"}`;
  else if (name === "read_tab") label = `Read "${out.title ?? "page"}"`;
  else if (name === "open_tab") label = `Opened ${out.title ?? input.url}`;
  else if (name === "list_tabs") label = "Looked at your tabs";
  else if (name === "switch_tab") label = "Switched tab";
  else if (name === "close_tab") label = "Closed a tab";
  if (out.ok === false) label = out.error ?? label;
  const failed = part.state === "output-error",
    warning = out.ok === false || out.isError;
  return (
    <div
      className={`tool-chip ${isMemory ? "memory-chip" : ""} ${name === "highlight" ? "highlight-chip" : ""} ${failed ? "error" : ""} ${warning ? "warning" : ""}`}
    >
      <button
        title={label}
        onClick={() => {
          if (tab && input.id)
            void runInTab(tab, highlightElement, [
              input.id,
              input.note ?? label,
            ]).catch(() => {});
          else if (tab && ["open_tab", "read_tab", "switch_tab"].includes(name))
            void switchTab(tab).catch(() => {});
        }}
      >
        {pending ? (
          <Loader2 size={13} className="spin" />
        ) : failed || warning ? (
          <AlertTriangle size={13} />
        ) : isMemory ? (
          <Brain size={13} />
        ) : name === "highlight" ? (
          <MapPin size={13} />
        ) : isMcp ? (
          <ExternalLink size={13} />
        ) : (
          <Check size={13} />
        )}
        <span>
          {label}
          {pending && !label.endsWith("…") ? "…" : ""}
        </span>
      </button>
      {name === "remember" && out.saved && !out.duplicate && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void undoRemember(
              out.id,
              out.replaced?.map((m: any) => m.id),
            )
          }
        >
          Undo
        </Button>
      )}
    </div>
  );
}

export function settingsResultLabel(
  name: string,
  out: any,
  change: string,
): { label: string; warning: boolean } {
  if (out.ok === false)
    return { label: out.error ?? "Settings change failed", warning: true };
  switch (name) {
    case "get_settings":
      return { label: "Checked settings", warning: false };
    case "add_mcp_server":
      return out.connected
        ? {
            label: `Connected MCP server ${out.server?.name} · ${out.toolCount ?? 0} tools`,
            warning: false,
          }
        : {
            label: `Saved MCP server ${out.server?.name}, switched off: ${out.error ?? "Connection failed."}`,
            warning: true,
          };
    case "update_mcp_server":
      return {
        label: `Updated MCP server ${out.server?.name}`,
        warning: false,
      };
    case "remove_mcp_server":
      return { label: `Removed MCP server ${out.removed}`, warning: false };
    case "switch_model":
      return { label: `Switched to ${out.model}`, warning: false };
    case "set_embeddings":
      return {
        label: `Embeddings ${out.enabled ? "on" : "off"}`,
        warning: false,
      };
    case "set_memory_enabled":
      return { label: `Memory ${out.enabled ? "on" : "off"}`, warning: false };
    case "set_web_search":
      return {
        label: `Web search ${out.enabled ? "on" : "off"}`,
        warning: false,
      };
    default:
      return { label: change, warning: false };
  }
}

/** Settings changes get their own approval card (amber, gear) and result chips;
 * the change text comes from the input, so it survives a panel reload. */
export function SettingsToolView({
  part,
  name,
  onApproval,
}: {
  part: any;
  name: string;
  onApproval: (v: { id: string; approved: boolean }) => void;
}) {
  const input = part.input ?? {},
    out = part.output ?? {},
    pending = !["output-available", "output-error", "output-denied"].includes(
      part.state,
    ),
    change = describeSettingsChange(name, input);
  if (part.state === "approval-requested")
    return (
      <div
        className="approval-card settings-approval"
        role="group"
        aria-label="Settings approval"
      >
        <strong>
          <Settings size={13} /> {change}?
        </strong>
        <p>This changes AMA's settings. You can undo it in Settings.</p>
        <div className="row">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onApproval({ id: part.approval.id, approved: false })
            }
          >
            Deny
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onApproval({ id: part.approval.id, approved: true })}
          >
            Allow
          </Button>
        </div>
      </div>
    );
  if (part.state === "output-denied")
    return (
      <div className="tool-chip">
        <button title={`Skipped: ${change}`}>
          <AlertTriangle size={13} />
          <span>Skipped: {change}</span>
        </button>
      </div>
    );
  if (part.state === "output-error")
    return (
      <div className="tool-chip error">
        <button title={part.errorText ?? "Tool failed"}>
          <AlertTriangle size={13} />
          <span>{part.errorText ?? "Tool failed"}</span>
        </button>
      </div>
    );
  if (pending)
    return (
      <div className="tool-chip">
        <button title={`${change}…`}>
          <Loader2 size={13} className="spin" />
          <span>{change}…</span>
        </button>
      </div>
    );
  const { label, warning } = settingsResultLabel(name, out, change);
  return (
    <div className={`tool-chip ${warning ? "warning" : ""}`}>
      <button title={label}>
        {warning ? <AlertTriangle size={13} /> : <Settings size={13} />}
        <span>{label}</span>
      </button>
    </div>
  );
}
