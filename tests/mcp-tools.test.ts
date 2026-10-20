import { it, expect, vi } from "vitest";
import {
  McpTools,
  mcpNeedsApproval,
  slug,
  testMcpServer,
} from "@/lib/mcp-tools";
it("classifies hints and names", () => {
  expect(mcpNeedsApproval("getItem")).toBe(false);
  expect(mcpNeedsApproval("update")).toBe(true);
  expect(
    mcpNeedsApproval("get", { readOnlyHint: true, destructiveHint: true }),
  ).toBe(true);
  expect(mcpNeedsApproval("write", { readOnlyHint: true })).toBe(false);
  expect(slug(" Notes / 中文 ")).toBe("notes");
  expect(slug("中文")).toBe("mcp");
});
it("prefixes, limits names and retries one failed connection", async () => {
  const close = vi.fn(async () => {}),
    factory = vi
      .fn()
      .mockRejectedValueOnce(new Error("reset"))
      .mockImplementation(async () => ({
        tools: async () => ({
          get_item: { description: "Read" },
          write: { annotations: { readOnlyHint: true } },
          ["x".repeat(100)]: {},
        }),
        close,
        getInstructions: () => "Notes data",
      }));
  const mcp = new McpTools(factory);
  const r = await mcp.load(
    [1, 2].map((n) => ({
      id: String(n),
      name: "My Notes",
      url: `http://local/${n}`,
      token: "",
      enabled: true,
    })),
  );
  expect(r.servers.every((s) => s.ok)).toBe(true);
  expect(Object.keys(r.tools)).toContain("my_notes_get_item");
  expect(Object.keys(r.tools)).toContain("my_notes_2_get_item");
  expect(Object.keys(r.tools).every((k) => k.length <= 64)).toBe(true);
  expect(r.tools.my_notes_write.needsApproval).toBe(false);
  expect(factory).toHaveBeenCalledTimes(3);
  await mcp.close();
  expect(close).toHaveBeenCalledTimes(2);
});
it("honors SDK metadata and closes disabled connections without prefix collisions", async () => {
  const close = vi.fn(async () => {});
  const factory = vi.fn(async () => ({
    tools: async () => ({
      write: { metadata: { annotations: { readOnlyHint: true } } },
    }),
    close,
  }));
  const mcp = new McpTools(factory as any);
  const servers = ["Notes", "Notes_3", "Notes"].map((name, i) => ({
    id: String(i),
    name,
    url: `http://local/${i}`,
    token: "",
    enabled: true,
  }));
  const result = await mcp.load(servers);
  expect(new Set(result.servers.map((s) => s.prefix)).size).toBe(3);
  expect(
    Object.values(result.tools).every((t) => t.needsApproval === false),
  ).toBe(true);
  await mcp.load(servers.map((s) => ({ ...s, enabled: false })));
  expect(close).toHaveBeenCalledTimes(3);
});
it("shares one connection for servers using the same URL and token", async () => {
  const close = vi.fn(async () => {});
  const factory = vi.fn(async () => ({
    tools: async () => ({ get_item: {} }),
    close,
  }));
  const mcp = new McpTools(factory as any);
  await mcp.load(
    ["A", "B"].map((name) => ({
      id: name,
      name,
      url: "http://same",
      token: "",
      enabled: true,
    })),
  );
  expect(factory).toHaveBeenCalledOnce();
  await mcp.close();
  expect(close).toHaveBeenCalledOnce();
});
it("reports failure after two attempts", async () => {
  const factory = vi.fn(async () => {
    throw new Error("offline");
  });
  const r = await new McpTools(factory).load([
    { id: "x", name: "X", url: "http://local", token: "", enabled: true },
  ]);
  expect(r.servers[0]).toMatchObject({ ok: false, error: "offline" });
  expect(factory).toHaveBeenCalledTimes(2);
});

it("tests a server through a throwaway connection and closes it", async () => {
  const close = vi.fn(async () => {}),
    factory = vi.fn(async () => ({
      tools: async () => ({ get_item: {}, write: {} }),
      close,
    }));
  const status = await testMcpServer(
    { id: "x", name: "X", url: "http://local", token: "", enabled: false },
    factory as any,
  );
  expect(status).toMatchObject({ name: "X", ok: true, toolCount: 2 });
  expect(close).toHaveBeenCalledOnce();
});
