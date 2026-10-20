import type { McpServerConfig } from "./settings";

/** Validate before transport creation, so malformed credentials never reach fetch
 * or leak their values through browser header-validation errors. */
export function mcpHeaders(
  server: Pick<McpServerConfig, "token" | "headers">,
): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  if (server.token) result.authorization = `Bearer ${server.token}`;
  const entries = Object.entries(server.headers ?? {});
  if (entries.length > 50)
    throw new Error("MCP supports at most 50 custom headers.");
  const seen = new Set<string>();
  for (const [key, value] of entries) {
    const name = key.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || name.length > 200)
      throw new Error("Invalid MCP header name.");
    if (seen.has(name))
      throw new Error("Duplicate MCP header name (case-insensitive).");
    // Transport must own framing, negotiation and session routing. Browser-
    // forbidden headers are not a route to cookies or impersonating origins.
    if (
      [
        "accept",
        "content-type",
        "mcp-session-id",
        "mcp-protocol-version",
        "last-event-id",
        "host",
        "content-length",
        "connection",
        "cookie",
        "cookie2",
        "origin",
        "referer",
        "user-agent",
        "accept-encoding",
        "access-control-request-headers",
        "access-control-request-method",
        "date",
        "dnt",
        "expect",
        "keep-alive",
        "permissions-policy",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "via",
      ].includes(name) ||
      /^(?:sec-|proxy-)/.test(name)
    )
      throw new Error(
        "This MCP header is reserved by the browser or transport.",
      );
    if (
      typeof value !== "string" ||
      value.length > 8192 ||
      /[^\t\x20-\x7e\x80-\xff]/.test(value)
    )
      throw new Error(
        "Invalid MCP header value; use a single-line HTTP header string.",
      );
    seen.add(name);
    result[name] = value.trim();
  }
  // Validate the implicit Bearer value too, without including it in errors.
  if (
    result.authorization !== undefined &&
    (result.authorization.length > 8192 ||
      /[^\t\x20-\x7e\x80-\xff]/.test(result.authorization))
  )
    throw new Error("Invalid MCP authorization value.");
  return result;
}
export function parseMcpHeaders(text: string): Record<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Headers must be a JSON object of string values.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.values(value).some((v) => typeof v !== "string")
  )
    throw new Error("Headers must be a JSON object of string values.");
  mcpHeaders({ token: "", headers: value as Record<string, string> });
  return value as Record<string, string>;
}
export const mcpConnectionKey = (server: McpServerConfig) =>
  JSON.stringify([
    server.url,
    Object.entries(mcpHeaders(server)).sort(([a], [b]) => a.localeCompare(b)),
  ]);
