import { useEffect, useState } from "react";
import { parseMcpHeaders } from "@/lib/mcp-headers";
import {
  getMcpServers,
  type Settings,
  type McpServerConfig,
} from "@/lib/settings";
import { testMcpServer } from "@/lib/mcp-tools";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Field } from "./ui/field";
function ServerCard({
  server,
  onChange,
  onRemove,
}: {
  server: McpServerConfig;
  onChange: (s: McpServerConfig) => void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState(""),
    [headers, setHeaders] = useState(
      JSON.stringify(server.headers ?? {}, null, 2),
    ),
    [headerError, setHeaderError] = useState("");
  useEffect(() => {
    setHeaders(JSON.stringify(server.headers ?? {}, null, 2));
    setHeaderError("");
  }, [server.id]);
  return (
    <section
      className="card"
      role="group"
      aria-label={`MCP server ${server.name}`}
    >
      <div className="section-heading">
        <h3>{server.name}</h3>
        <Switch
          aria-label={`Use ${server.name}`}
          checked={server.enabled}
          onCheckedChange={(enabled) => onChange({ ...server, enabled })}
        />
      </div>
      {(["name", "url", "token"] as const).map((k) => (
        <Field
          key={k}
          label={k === "url" ? "URL" : k === "name" ? "Name" : "Token"}
        >
          <input
            type={k === "token" ? "password" : "text"}
            value={server[k]}
            onChange={(e) => onChange({ ...server, [k]: e.target.value })}
          />
        </Field>
      ))}
      <Field
        label="Headers (JSON)"
        hint={
          'String values only, e.g. {"X-API-Key": "your-key"}. Custom Authorization overrides Token (case-insensitive). Stored locally; also uploaded to Chrome if configuration sync is enabled. Sent to this MCP server, not injected into the chat model. Browser/transport-reserved headers are rejected.'
        }
      >
        <textarea
          aria-label="Headers (JSON)"
          value={headers}
          rows={4}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!headerError}
          onChange={(e) => {
            const text = e.target.value;
            setHeaders(text);
            try {
              const parsed = parseMcpHeaders(text);
              setHeaderError("");
              setResult("");
              onChange({ ...server, headers: parsed });
            } catch (e) {
              setHeaderError(
                e instanceof Error ? e.message : "Invalid headers.",
              );
            }
          }}
        />
      </Field>
      {headerError && (
        <p role="alert">
          {headerError} Last valid saved headers remain in use until corrected.
        </p>
      )}
      <div className="row">
        <Button
          variant="outline"
          disabled={busy || !!headerError}
          onClick={async () => {
            setBusy(true);
            try {
              const s = await testMcpServer({ ...server, enabled: true });
              setResult(
                s.ok
                  ? `Connected · ${s.toolCount} tools`
                  : (s.error ?? "Connection failed"),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Testing…" : "Test connection"}
        </Button>
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <p className="hint" role="status">
        {result}
      </p>
    </section>
  );
}
export function McpSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const servers = getMcpServers(settings);
  const update = (mcpServers: McpServerConfig[]) =>
    onChange({ ...settings, mcpServers });
  return (
    <section>
      <h2>MCP servers</h2>
      <p className="hint">
        Connect tools to search your notes and work across services. Tools that
        change data ask for approval.
      </p>
      {servers.map((s, i) => (
        <ServerCard
          key={s.id}
          server={s}
          onChange={(server) =>
            update(servers.map((s, j) => (i === j ? server : s)))
          }
          onRemove={() => update(servers.filter((_, j) => j !== i))}
        />
      ))}
      <Button
        variant="outline"
        onClick={() =>
          update([
            ...servers,
            {
              id: crypto.randomUUID(),
              name: "New server",
              url: "http://127.0.0.1:3000/mcp",
              token: "",
              headers: {},
              enabled: false,
            },
          ])
        }
      >
        Add server
      </Button>
    </section>
  );
}
