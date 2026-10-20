import { expect, it, vi } from "vitest";
import {
  mcpHeaders,
  mcpConnectionKey,
  parseMcpHeaders,
} from "@/lib/mcp-headers";
import { McpTools } from "@/lib/mcp-tools";
const server = {
  id: "s",
  name: "Server",
  url: "http://local/mcp",
  token: "",
  enabled: true,
};
it("merges bearer auth and custom headers with case-insensitive explicit auth precedence", () => {
  expect(mcpHeaders({ token: "" })).toEqual({});
  expect(
    mcpHeaders({ token: "abc", headers: { "X-API-Key": " secret " } }),
  ).toEqual({ authorization: "Bearer abc", "x-api-key": "secret" });
  expect(
    mcpHeaders({ token: "unused", headers: { Authorization: "Basic xyz" } }),
  ).toEqual({ authorization: "Basic xyz" });
  expect(
    mcpConnectionKey({ ...server, headers: { "X-B": "2", "X-A": "1" } }),
  ).toBe(mcpConnectionKey({ ...server, headers: { "x-a": "1", "x-b": "2" } }));
  expect(
    mcpConnectionKey({
      ...server,
      token: "unused",
      headers: { Authorization: "Basic xyz" },
    }),
  ).toBe(
    mcpConnectionKey({ ...server, headers: { authorization: "Basic xyz" } }),
  );
});
it("rejects invalid names, CRLF injection, reserved headers, duplicate case and nonstring JSON without leaking values", () => {
  for (const headers of [
    { "bad name": "SECRET" },
    { "X-Key": "SECRET\r\nInjected: yes" },
    { Host: "SECRET" },
    { "Content-Type": "SECRET" },
    { "Mcp-Session-Id": "SECRET" },
    { "Sec-Fetch-Site": "SECRET" },
    { "X-A": "1", "x-a": "SECRET" },
  ] as Record<string, string>[]) {
    expect(() => mcpHeaders({ token: "", headers })).toThrow();
    try {
      mcpHeaders({ token: "", headers });
    } catch (e) {
      expect(String(e)).not.toContain("SECRET");
    }
  }
  for (const text of [
    "[]",
    "null",
    '{"X-Key":123}',
    '{"X-Key":',
    '{"Cookie":"secret"}',
  ])
    expect(() => parseMcpHeaders(text)).toThrow();
  expect(parseMcpHeaders('{"X-Key":"value"}')).toEqual({ "X-Key": "value" });
  expect(() => mcpHeaders({ token: "bad\nvalue" })).toThrow("authorization");
});
it("reconnects when effective headers change, shares reordered equivalents and closes stale clients", async () => {
  const close = vi.fn(async () => {}),
    factory = vi.fn(async () => ({ tools: async () => ({ read: {} }), close }));
  const mcp = new McpTools(factory as any);
  await mcp.load([{ ...server, headers: { "X-API-Key": "one" } }]);
  expect((factory.mock.calls as any)[0][0].transport.headers).toEqual({
    "x-api-key": "one",
  });
  await mcp.load([{ ...server, headers: { "x-api-key": "one" } }]);
  expect(factory).toHaveBeenCalledTimes(1);
  await mcp.load([{ ...server, headers: { "X-API-Key": "two" } }]);
  expect(close).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledTimes(2);
  const result = await mcp.load([
    { ...server, headers: { "X-Key": "SECRET\ninvalid" } },
  ]);
  expect(result.servers[0].ok).toBe(false);
  expect(result.servers[0].error).not.toContain("SECRET");
  expect(close).toHaveBeenCalledTimes(2);
  expect(factory).toHaveBeenCalledTimes(2);
});
