import { useState } from "react";
import { ArrowLeft, Brain, SlidersHorizontal, Wrench } from "lucide-react";
import { PROVIDERS, type Settings, type ProviderId } from "@/lib/settings";
import { listModelsWithInfo } from "@/lib/list-models";
import { formatTokens } from "@/lib/context-usage";
import { catalogModelInfo } from "@/lib/model-catalog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
import { Switch } from "./ui/switch";
import { EmbeddingSettings } from "./embedding-settings";
import { McpSettings } from "./mcp-settings";
import { FileSettings } from "./file-settings";
import { WebSearchSettings } from "./web-search-settings";
import { ModelPicker } from "./model-picker";
import { ConfigSyncSettings } from "./config-sync-settings";
export function SettingsView({
  settings,
  onChange,
  onBack,
  onMemory,
  tab,
  onTab,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onBack: () => void;
  onMemory: () => void;
  tab: string;
  onTab: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const p = settings.provider,
    c = settings.providers[p];
  const update = (patch: Partial<typeof c>) =>
    onChange({
      ...settings,
      providers: { ...settings.providers, [p]: { ...c, ...patch } },
    });
  const infoCount = c.modelInfo ? Object.keys(c.modelInfo).length : 0,
    currentInfo = c.modelInfo?.[c.model],
    catalogInfo = catalogModelInfo(p, c.model, c.baseURL),
    effectiveInfo = currentInfo ?? catalogInfo;
  return (
    <div className="view">
      <header>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to chat"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </Button>
        <h1>Settings</h1>
        <span className="local-label">YOUR CONFIG</span>
      </header>
      <Tabs value={tab} onValueChange={(v) => onTab(String(v))}>
        <TabsList className="tabs-list">
          <TabsTrigger value="model">
            <SlidersHorizontal size={14} />
            Model
          </TabsTrigger>
          <TabsTrigger value="memory">
            <Brain size={14} />
            Memory
          </TabsTrigger>
          <TabsTrigger value="tools">
            <Wrench size={14} />
            Tools
          </TabsTrigger>
        </TabsList>
        <TabsContent value="model" className="settings-body">
          <h2>Your model, your choice</h2>
          <p className="hint">
            AMA connects directly to your provider. No backend, no account.
          </p>
          <Field label="Provider">
            <select
              value={p}
              onChange={(e) =>
                onChange({
                  ...settings,
                  provider: e.target.value as ProviderId,
                })
              }
            >
              {Object.entries(PROVIDERS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="API key"
            hint="Stored locally; included in Chrome configuration sync only when you enable it below."
          >
            <input
              type="password"
              placeholder={p === "openai-compatible" ? "Optional" : "Required"}
              value={c.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
          </Field>
          <div className="field">
            <span>Model</span>
            <div className="row">
              <ModelPicker
                key={p}
                settings={settings}
                onChange={onChange}
                provider={p}
              />
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const { models, info } = await listModelsWithInfo(p, c);
                    update({
                      models,
                      modelInfo: { ...(c.modelInfo ?? {}), ...info },
                    });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Fetching…" : "Fetch"}
              </Button>
            </div>
            <p className="hint">
              {c.models?.length
                ? `${c.models.length} models available from /models. Search here or in the chat; enter an ID and select Use to add a custom model.`
                : "Fetch models, or search and select Use to set a custom model ID."}
            </p>
            {(c.modelInfo !== undefined || catalogInfo) && (
              <p className="hint" role="status">
                {effectiveInfo
                  ? `Model info: ${
                      [
                        effectiveInfo.maxInputTokens &&
                          `context ${formatTokens(effectiveInfo.maxInputTokens)}`,
                        effectiveInfo.maxOutputTokens &&
                          `output ${formatTokens(effectiveInfo.maxOutputTokens)}`,
                        effectiveInfo.pricing && "pricing",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "no limits or prices"
                    }.${
                      effectiveInfo.source === "models.dev"
                        ? " Context from models.dev; the gateway may be lower."
                        : ""
                    }`
                  : infoCount
                    ? `/models returned data for ${infoCount} models, but not for ${c.model}.`
                    : "/models returned no context limits or prices for the fetched models. Check the Base URL and provider response."}
              </p>
            )}
          </div>
          <Field
            label="Base URL"
            hint={
              p === "openai-compatible"
                ? "Required. An OpenAI-compatible API endpoint."
                : "Optional. Leave blank to use the official provider endpoint."
            }
          >
            <input
              value={c.baseURL}
              placeholder={
                p === "openai-compatible"
                  ? "https://your-api.example/v1"
                  : "Default provider endpoint"
              }
              onChange={(e) => update({ baseURL: e.target.value })}
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <hr />
          <ConfigSyncSettings />
        </TabsContent>
        <TabsContent value="memory" className="settings-body">
          <h2>A little continuity</h2>
          <p className="hint">
            Keep preferences and useful references across conversations. You
            control what stays.
          </p>
          <Button variant="outline" onClick={onMemory}>
            <Brain size={15} />
            Manage memories
          </Button>
          <hr />
          <EmbeddingSettings settings={settings} onChange={onChange} />
        </TabsContent>
        <TabsContent value="tools" className="settings-body">
          <section>
            <div className="section-heading">
              <h2>Danger mode</h2>
              <Switch
                aria-label="Danger mode"
                checked={settings.dangerMode === true}
                onCheckedChange={(enabled) =>
                  onChange({ ...settings, dangerMode: enabled })
                }
              />
            </div>
            <p className="hint">
              Trust the AI: skip approvals for memory saves/deletions (including
              sensitive information), reading other tabs and browser UI actions,
              including submitting forms, payments and deletions. Repeated
              learned habits activate automatically once they have enough
              evidence. Mistakes may expose private data or cause irreversible
              changes.
            </p>
            <p className="hint">
              Off by default. Changes apply to the next request; stop a running
              reply before switching. Existing approval cards still need a
              decision. Memory Off, file/MCP approvals, workspace boundaries and
              browser permissions remain in force. This setting is included in
              optional configuration sync.
            </p>
          </section>
          <hr />
          <WebSearchSettings settings={settings} onChange={onChange} />
          <hr />
          <FileSettings />
          <hr />
          <McpSettings settings={settings} onChange={onChange} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
