import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  getEmbeddingConfig,
  getMcpServers,
  getModelGroups,
  getWebSearchConfig,
  selectModel,
  settingsStore,
  type McpServerConfig,
  type ProviderId,
  type Settings,
} from "./settings";
import { mcpHeaders } from "./mcp-headers";
import { testMcpServer, type McpServerStatus } from "./mcp-tools";
import { isMemoryEnabled, setMemoryEnabled } from "./memory/store";

/** Tools that read or change AMA's own settings from chat. Every write needs
 * approval and never echoes a stored secret back to the model. */
export const SETTINGS_TOOLS = [
  "get_settings",
  "add_mcp_server",
  "update_mcp_server",
  "remove_mcp_server",
  "switch_model",
  "set_embeddings",
  "set_memory_enabled",
  "set_web_search",
] as const;

export type SettingsToolName = (typeof SETTINGS_TOOLS)[number];

export interface ServerTest {
  ok: boolean;
  toolCount?: number;
  error?: string;
}

export interface SettingsToolsOptions {
  load?: () => Promise<Settings>;
  save: (settings: Settings) => Promise<void>;
  testServer?: (server: McpServerConfig) => Promise<ServerTest>;
  newId?: () => string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fail = (e: unknown) => ({ ok: false as const, error: message(e) });

/** Serializes read-modify-write so parallel tool calls cannot drop a change. */
let pending: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = pending.then(fn, fn);
  pending = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const httpSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((raw) => {
    try {
      const url = new URL(raw.trim());
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Use an http:// or https:// URL without embedded credentials.");

function httpURL(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("MCP URL must be a valid http:// or https:// URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("MCP URL must start with http:// or https://.");
  if (url.username || url.password)
    throw new Error(
      "Do not put credentials in the MCP URL; use the token or headers instead.",
    );
  return url.href;
}

const canonicalUrl = (raw: string) =>
  raw.trim().replace(/\/+$/, "").toLowerCase();

/** `recap-service.example.com` → `Recap Service`; numeric hosts and
 * localhost keep `host:port` so several local servers stay distinguishable. */
export function nameFromUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "MCP server";
  }
  const labels = url.hostname
    .replace(/^www\./i, "")
    .split(".")
    .filter(Boolean);
  const first = labels[0] ?? "";
  if (
    !first ||
    url.hostname === "localhost" ||
    /^\d+$/.test(first) ||
    labels.every((label) => /^\d+$/.test(label))
  )
    return url.host;
  return first
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 40);
}

function findServer(
  servers: McpServerConfig[],
  query: string,
): McpServerConfig | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const byName = servers.filter((s) => s.name.toLowerCase() === q);
  if (byName.length) return byName[0];
  const byUrl = servers.filter((s) => canonicalUrl(s.url) === canonicalUrl(q));
  if (byUrl.length) return byUrl[0];
  return servers.find(
    (s) => s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q),
  );
}

const configured = (servers: McpServerConfig[]) =>
  servers.map((s) => s.name).join(", ") || "none";

const summary = (server: McpServerConfig) => ({
  name: server.name,
  url: server.url,
  enabled: server.enabled,
  hasToken: !!server.token,
});

function ensureName(name: string) {
  const value = name.trim();
  if (!value) throw new Error("MCP server name is required.");
  if (value.length > 40)
    throw new Error("MCP server name must be 40 characters or fewer.");
  return value;
}

function ensureUniqueName(
  servers: McpServerConfig[],
  name: string,
  exceptId?: string,
) {
  const duplicate = servers.find(
    (s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase(),
  );
  if (duplicate)
    throw new Error(
      `Another MCP server is already named "${duplicate.name}". Choose a different name.`,
    );
}

/** Secret-free wording for the approval card. */
export function describeSettingsChange(name: string, input: any = {}): string {
  switch (name) {
    case "get_settings":
      return "Check AMA settings";
    case "add_mcp_server": {
      const label = input.name ? `“${input.name}” ` : "";
      const extra = input.token
        ? " with a token"
        : input.headers && Object.keys(input.headers).length
          ? " with headers"
          : "";
      return `Add MCP server ${label}${input.url ?? ""}${extra}`;
    }
    case "update_mcp_server": {
      const changes: string[] = [];
      if (input.enabled !== undefined)
        changes.push(input.enabled ? "switch on" : "switch off");
      if (input.name !== undefined) changes.push(`rename to “${input.name}”`);
      if (input.url !== undefined) changes.push(`URL ${input.url}`);
      if (input.token !== undefined) changes.push("new token");
      if (input.headers !== undefined) changes.push("new headers");
      return `Change MCP server “${input.server ?? ""}”: ${changes.join(", ") || "no changes"}`;
    }
    case "remove_mcp_server":
      return `Remove MCP server “${input.server ?? ""}”`;
    case "switch_model":
      return `Switch the chat model to ${input.model ?? ""}`;
    case "set_embeddings":
      return `Turn embeddings ${input.enabled ? "on" : "off"}`;
    case "set_memory_enabled":
      return `Turn memory ${input.enabled ? "on" : "off"}`;
    case "set_web_search":
      return `Turn web search ${input.enabled ? "on" : "off"}`;
    default:
      return name.replace(/_/g, " ");
  }
}

/** Builds the settings tools. `save` is injected so tests (and the transport)
 * can decide where settings live; every write loads the latest settings. */
export function createSettingsTools({
  load = () => settingsStore.getValue(),
  save,
  testServer = (server) => testMcpServer(server),
  newId = () => crypto.randomUUID(),
}: SettingsToolsOptions): ToolSet {
  const write = (
    fn: (
      settings: Settings,
    ) =>
      | Promise<{ next: Settings; result: any }>
      | { next: Settings; result: any },
  ): Promise<any> =>
    serialized(async () => {
      const settings = await load();
      try {
        const { next, result } = await fn(settings);
        await save(next);
        return result;
      } catch (e) {
        return fail(e);
      }
    });

  return {
    get_settings: tool({
      description:
        "Read AMA's current settings: chat model, configured models, MCP servers, embeddings and memory/web search on/off. Secrets are never returned (only whether a token exists). Use when the user asks what is configured, or before changing something.",
      inputSchema: z.object({}),
      execute: async () => {
        const settings = await load();
        const embedding = getEmbeddingConfig(settings),
          web = getWebSearchConfig(settings);
        return {
          model: {
            provider: settings.provider,
            model: settings.providers[settings.provider]?.model ?? "",
          },
          models: getModelGroups(settings).map(({ provider, models }) => ({
            provider,
            models,
          })),
          mcpServers: getMcpServers(settings).map((s) => ({
            name: s.name,
            url: s.url,
            enabled: s.enabled,
            hasToken: !!s.token,
          })),
          embeddings: { enabled: embedding.enabled, url: embedding.url },
          memoryEnabled: await isMemoryEnabled(),
          webSearchEnabled: web.enabled,
          note: "API keys and base URLs can only be seen and changed in Settings.",
        };
      },
    }),
    add_mcp_server: tool({
      description:
        "Add a Streamable-HTTP MCP server. The URL is tested first: if it connects it is saved enabled, otherwise it is saved switched off. Name is optional (derived from the URL); max 40 characters. `token` is stored but never shown. Omit headers to keep none. Use only when the user asks to connect a server.",
      inputSchema: z.object({
        url: httpSchema,
        name: z.string().min(1).max(40).optional(),
        token: z.string().max(8192).optional(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
      needsApproval: true,
      execute: async (input) =>
        write(async (settings) => {
          const url = httpURL(input.url),
            servers = getMcpServers(settings);
          const existing =
            servers.find((s) => canonicalUrl(s.url) === canonicalUrl(url)) ??
            (input.name
              ? servers.find(
                  (s) =>
                    s.name.toLowerCase() === input.name!.trim().toLowerCase(),
                )
              : undefined);
          const name = ensureName(
            input.name || existing?.name || nameFromUrl(url),
          );
          ensureUniqueName(servers, name, existing?.id);
          const token =
            input.token === undefined ? (existing?.token ?? "") : input.token;
          const headers =
            input.headers === undefined
              ? (existing?.headers ?? {})
              : input.headers;
          mcpHeaders({ token, headers });
          const draft: McpServerConfig = {
            id: existing?.id ?? newId(),
            name,
            url,
            token,
            headers: Object.keys(headers).length ? { ...headers } : {},
            enabled: true,
          };
          let status: ServerTest;
          try {
            status = await testServer(draft);
          } catch (e) {
            status = { ok: false, error: message(e) };
          }
          const server = { ...draft, enabled: status.ok },
            next = {
              ...settings,
              mcpServers: existing
                ? servers.map((s) => (s.id === server.id ? server : s))
                : [...servers, server],
            };
          if (status.ok)
            return {
              next,
              result: {
                ok: true as const,
                connected: true,
                server: summary(server),
                toolCount: status.toolCount ?? 0,
                note: "Its tools are available from the next message.",
              },
            };
          return {
            next,
            result: {
              ok: true as const,
              connected: false,
              server: summary(server),
              error: status.error ?? "Connection failed.",
              note: "Saved but switched off. Fix the URL or token (update_mcp_server), then switch it on.",
            },
          };
        }),
    }),
    update_mcp_server: tool({
      description:
        "Change an existing MCP server. Identify it by name or URL. Only the fields you pass change; omit `token` to keep the saved one (empty string clears it). Switching on does not test the connection. Use when the user asks to enable, disable, rename, re-point or re-token a configured server.",
      inputSchema: z.object({
        server: z.string().min(1).max(2000),
        enabled: z.boolean().optional(),
        name: z.string().min(1).max(40).optional(),
        url: httpSchema.optional(),
        token: z.string().max(8192).optional(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
      needsApproval: true,
      execute: async (input) =>
        write(async (settings) => {
          const servers = getMcpServers(settings),
            match = findServer(servers, input.server);
          if (!match)
            return {
              next: settings,
              result: {
                ok: false as const,
                error: `No MCP server matches "${input.server}". Configured: ${configured(servers)}.`,
              },
            };
          const server: McpServerConfig = { ...match };
          if (input.enabled !== undefined) server.enabled = input.enabled;
          if (input.name !== undefined) {
            server.name = ensureName(input.name);
            ensureUniqueName(servers, server.name, server.id);
          }
          if (input.url !== undefined) server.url = httpURL(input.url);
          if (input.token !== undefined) server.token = input.token;
          if (input.headers !== undefined)
            server.headers = { ...input.headers };
          mcpHeaders(server);
          const next = {
            ...settings,
            mcpServers: servers.map((s) => (s.id === server.id ? server : s)),
          };
          return {
            next,
            result: {
              ok: true as const,
              server: summary(server),
              note: "Its tools are available from the next message.",
            },
          };
        }),
    }),
    remove_mcp_server: tool({
      description:
        "Remove a configured MCP server by name or URL. Nothing is deleted on the server itself. Use only when the user asks to remove one.",
      inputSchema: z.object({ server: z.string().min(1).max(2000) }),
      needsApproval: true,
      execute: async (input) =>
        write(async (settings) => {
          const servers = getMcpServers(settings),
            match = findServer(servers, input.server);
          if (!match)
            return {
              next: settings,
              result: {
                ok: false as const,
                error: `No MCP server matches "${input.server}". Configured: ${configured(servers)}.`,
              },
            };
          return {
            next: {
              ...settings,
              mcpServers: servers.filter((s) => s.id !== match.id),
            },
            result: { ok: true as const, removed: match.name },
          };
        }),
    }),
    switch_model: tool({
      description:
        "Switch the chat model. `model` must be in the configured model list (see get_settings). `provider` is required when the same id exists in several providers. Applies from the next message.",
      inputSchema: z.object({
        model: z.string().min(1).max(200),
        provider: z
          .enum(["openai", "anthropic", "google", "openai-compatible"])
          .optional(),
      }),
      needsApproval: true,
      execute: async (input) =>
        write(async (settings) => {
          const groups = getModelGroups(settings),
            choices =
              groups
                .map((g) => `${g.provider}: ${g.models.join(", ")}`)
                .join("; ") || "none";
          const group = input.provider
            ? groups.find(
                (g) =>
                  g.provider === input.provider &&
                  g.models.includes(input.model),
              )
            : (groups.find(
                (g) =>
                  g.provider === settings.provider &&
                  g.models.includes(input.model),
              ) ?? groups.find((g) => g.models.includes(input.model)));
          if (!group)
            return {
              next: settings,
              result: {
                ok: false as const,
                error: `"${input.model}" isn't one of the configured models. Choices: ${choices}.`,
              },
            };
          return {
            next: selectModel(
              settings,
              group.provider as ProviderId,
              input.model,
            ),
            result: {
              ok: true as const,
              provider: group.provider,
              model: input.model,
            },
          };
        }),
    }),
    set_embeddings: tool({
      description:
        "Turn semantic embeddings on or off. Endpoint, model and token stay as configured in Settings. Applies from the next message.",
      inputSchema: z.object({ enabled: z.boolean() }),
      needsApproval: true,
      execute: async ({ enabled }) =>
        write(async (settings) => {
          const embedding = { ...getEmbeddingConfig(settings), enabled };
          return {
            next: { ...settings, embedding },
            result: { ok: true as const, enabled },
          };
        }),
    }),
    set_memory_enabled: tool({
      description:
        "Turn AMA's memory on or off. Off keeps existing memories but stops saving and recall. Memory content is changed with remember/forget instead. Applies from the next message.",
      inputSchema: z.object({ enabled: z.boolean() }),
      needsApproval: true,
      execute: async ({ enabled }) => {
        try {
          await setMemoryEnabled(enabled);
          return { ok: true as const, enabled };
        } catch (e) {
          return fail(e);
        }
      },
    }),
    set_web_search: tool({
      description:
        "Turn DeepSeek public web search on or off. The API key can only be seen or changed in Settings. Without a key the tools stay off. Applies from the next message.",
      inputSchema: z.object({ enabled: z.boolean() }),
      needsApproval: true,
      execute: async ({ enabled }) =>
        write(async (settings) => {
          const webSearch = { ...getWebSearchConfig(settings), enabled };
          return {
            next: { ...settings, webSearch },
            result: { ok: true as const, enabled },
          };
        }),
    }),
  };
}
