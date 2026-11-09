import { expect, it, vi } from "vitest";
import { requestedComposerTool } from "@/lib/composer-tools";
import { matchingCommands } from "@/lib/composer-commands";
import { LocalChatTransport } from "@/lib/local-chat-transport";
import { DEFAULT_SETTINGS } from "@/lib/settings";

it("recognizes only deliberate leading tool requests", () => {
  expect(requestedComposerTool("@tool:notes_write_note write hello")).toEqual({
    name: "notes_write_note",
    argument: "write hello",
  });
  expect(requestedComposerTool(" @tool:run_js\ncompute")).toEqual({
    name: "run_js",
    argument: "compute",
  });
  expect(requestedComposerTool("@tool:run_js")).toEqual({
    name: "run_js",
    argument: "",
  });
  for (const text of [
    "email@tool:run_js",
    "hello @tool:run_js",
    "@tool:bad.name hello",
    "@tool:run_js<script>",
  ])
    expect(requestedComposerTool(text)).toBeNull();
  const catalog = [
    {
      name: "notes_write_note",
      description: "Write note",
      group: "MCP · Notes",
    },
  ];
  expect(matchingCommands("notes_write", catalog)[0].id).toBe(
    "tool:notes_write_note",
  );
  expect(matchingCommands("工具", catalog).map((c) => c.id)).toContain(
    "tool:notes_write_note",
  );
});
it("discovers actual built-in schemas without reading pages, executing code or calling a model", async () => {
  const readActivePage = vi.fn(),
    createModel = vi.fn(),
    runCode = vi.fn();
  const native = vi.fn();
  const transport = new LocalChatTransport({
    loadSettings: async () => ({ ...DEFAULT_SETTINGS, mcpServers: [] }),
    readActivePage,
    createModel,
    runCode,
  });
  const catalog = await transport.composerTools("catalog", native);
  expect(catalog.errors).toEqual([]);
  expect(catalog.tools.map((t) => t.name)).toEqual(
    expect.arrayContaining([
      "run_js",
      "read_file",
      "click",
      "search_history",
      "remember",
    ]),
  );
  expect(catalog.tools.some((t) => t.name === "web_search")).toBe(false);
  expect(native).toHaveBeenCalledOnce();
  expect(readActivePage).not.toHaveBeenCalled();
  expect(createModel).not.toHaveBeenCalled();
  expect(runCode).not.toHaveBeenCalled();
});

it("adds a tool-selection hint only when the user chose a tool", async () => {
  const { buildInstructions } = await import("@/lib/prompt");
  expect(
    buildInstructions(null, [], undefined, undefined, false),
  ).not.toContain("chose the tool");
  const prompt = buildInstructions(
    null,
    [],
    undefined,
    undefined,
    false,
    "notes_write_note",
  );
  expect(prompt).toContain('The user chose the tool "notes_write_note"');
  expect(prompt).toContain("not permission to skip confirmation");
});
