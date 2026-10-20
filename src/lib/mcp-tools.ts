import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { McpServerConfig } from "./settings";
import { mcpHeaders, mcpConnectionKey } from "./mcp-headers";
export interface McpServerStatus {
  name: string;
  ok: boolean;
  prefix: string;
  toolCount: number;
  error?: string;
  instructions?: string;
}
const infos = new Map<string, { server: string; tool: string }>();
export const getMcpToolInfo = (name: string) => infos.get(name);
export const slug = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "mcp";
export function mcpNeedsApproval(
  name: string,
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean },
) {
  if (annotations?.destructiveHint) return true;
  if (annotations?.readOnlyHint) return false;
  return !/^(list|get|search|read|find|fetch|query|lookup|describe)/i.test(
    name,
  );
}
/**
 * Loads a server once with a throwaway client (never a cached session) and
 * returns its status. Used by Settings' "Test connection" and the settings
 * tools, which must not wait for the chat transport's next request.
 */
export async function testMcpServer(
  server: McpServerConfig,
  factory: typeof createMCPClient = createMCPClient,
): Promise<McpServerStatus> {
  const mcp = new McpTools(factory);
  try {
    const { servers } = await mcp.load([{ ...server, enabled: true }]);
    return (
      servers[0] ?? {
        name: server.name,
        ok: false,
        prefix: slug(server.name),
        toolCount: 0,
        error: "No answer.",
      }
    );
  } finally {
    await mcp.close().catch(() => {});
  }
}
export class McpTools {
  private connections = new Map<string, Promise<any>>();
  constructor(private factory: typeof createMCPClient = createMCPClient) {}
  async close() {
    await Promise.all(
      [...this.connections.values()].map((c) =>
        c.then((client) => client.close()).catch(() => {}),
      ),
    );
    this.connections.clear();
  }
  async load(servers: McpServerConfig[]) {
    const tools: ToolSet = {},
      statuses: McpServerStatus[] = [],
      prefixes = new Set<string>();
    const active = new Set<string>();
    for (const server of servers.filter((s) => s.enabled && s.url)) {
      try {
        active.add(mcpConnectionKey(server));
      } catch {
        /* Report per server below. */
      }
    }
    for (const [key, client] of this.connections) {
      if (!active.has(key)) {
        this.connections.delete(key);
        await client.then((c) => c.close()).catch(() => {});
      }
    }
    await Promise.all(
      servers
        .filter((s) => s.enabled && s.url)
        .map(async (s, index) => {
          let prefix = slug(s.name);
          const base = prefix;
          let suffix = index + 1;
          while (prefixes.has(prefix)) prefix = `${base}_${suffix++}`;
          prefixes.add(prefix);
          let key: string;
          let headers: Record<string, string>;
          try {
            headers = mcpHeaders(s);
            key = mcpConnectionKey(s);
          } catch (e) {
            statuses.push({
              name: s.name,
              ok: false,
              prefix,
              toolCount: 0,
              error: e instanceof Error ? e.message : "Invalid MCP headers.",
            });
            return;
          }
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              let connection = this.connections.get(key);
              if (!connection) {
                connection = this.factory({
                  transport: {
                    type: "http",
                    url: s.url,
                    headers,
                    fetch: (i, n) => globalThis.fetch(i, n),
                  },
                });
                this.connections.set(key, connection);
              }
              const client = await connection;
              const remote = await client.tools();
              for (const [name, raw] of Object.entries(remote)) {
                let full =
                  `${prefix}_${/^[a-zA-Z0-9_-]+$/.test(name) ? name : slug(name)}`.slice(
                    0,
                    64,
                  );
                if (full in tools)
                  full = `${full.slice(0, 56)}_${Object.keys(tools).length}`;
                const t = raw as any;
                tools[full] = {
                  ...t,
                  needsApproval: mcpNeedsApproval(
                    name,
                    t.metadata?.annotations ?? t.annotations,
                  ),
                };
                infos.set(full, { server: s.name, tool: name });
              }
              statuses.push({
                name: s.name,
                ok: true,
                prefix,
                toolCount: Object.keys(remote).length,
                instructions: client.instructions ?? client.getInstructions?.(),
              });
              break;
            } catch (e) {
              const old = this.connections.get(key);
              this.connections.delete(key);
              void old?.then((c) => c.close()).catch(() => {});
              if (attempt === 1)
                statuses.push({
                  name: s.name,
                  ok: false,
                  prefix,
                  toolCount: 0,
                  error: e instanceof Error ? e.message : String(e),
                });
            }
          }
        }),
    );
    return { tools, servers: statuses };
  }
}
