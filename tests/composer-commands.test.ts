import { expect, it } from "vitest";
import {
  commandQuery,
  matchingCommands,
  parseComposerCommand,
} from "@/lib/composer-commands";

it("opens on a leading @ and filters by command or Chinese keywords", () => {
  expect(commandQuery("@", 1)).toEqual({ query: "", start: 0, end: 1 });
  expect(matchingCommands("").map((c) => c.id)).toEqual([
    "compact",
    "memory",
    "memory-list",
    "tools",
  ]);
  expect(matchingCommands("mem").map((c) => c.id)).toEqual([
    "memory",
    "memory-list",
  ]);
  expect(matchingCommands("压缩").map((c) => c.id)).toEqual(["compact"]);
  expect(matchingCommands("记忆").map((c) => c.id)).toEqual([
    "memory",
    "memory-list",
  ]);
  expect(matchingCommands("missing")).toEqual([]);
  expect(commandQuery("  @mem hello", 6)?.query).toBe("mem");
});
it("does not treat emails, inline mentions, selections or existing arguments as suggestions", () => {
  for (const text of [
    "user@example.com",
    "hello @mem",
    "@memory hello",
    "@@",
    "https://example.com/@compact",
  ])
    expect(commandQuery(text, text.length)).toBeNull();
  expect(commandQuery("@memory", 0, 7)).toBeNull();
});
it("only dispatches registered leading commands and preserves literal multi-line memory text", () => {
  expect(parseComposerCommand("@memory 默认中文\n先给结论")).toEqual({
    id: "memory",
    argument: "默认中文\n先给结论",
  });
  expect(parseComposerCommand(" @COMPACT ")).toEqual({
    id: "compact",
    argument: "",
  });
  expect(parseComposerCommand("@memory-list unexpected text")?.argument).toBe(
    "unexpected text",
  );
  expect(parseComposerCommand("@cli rm -rf /tmp/example")).toBeNull();
  expect(parseComposerCommand("hello @compact")).toBeNull();
});
