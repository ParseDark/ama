import { it, expect } from "vitest";
import { filterMcpTools } from "@/lib/tool-filter";
import { DEFAULT_EMBEDDING } from "@/lib/settings";
const config = { ...DEFAULT_EMBEDDING, enabled: true };
it("keeps top eight plus used tools in original order", async () => {
  const tools: any = Object.fromEntries(
    Array.from({ length: 15 }, (_, i) => [
      `tool${i}`,
      { description: String(i) },
    ]),
  );
  const filtered = await filterMcpTools(tools, {
    config,
    queryVector: [1, 0],
    used: new Set(["tool14"]),
    embedDocuments: async (ts) => ts.map((_, i) => [1 - i * 0.05, i * 0.05]),
  });
  expect(Object.keys(filtered)).toEqual([
    "tool0",
    "tool1",
    "tool2",
    "tool3",
    "tool4",
    "tool5",
    "tool6",
    "tool7",
    "tool14",
  ]);
  expect(await filterMcpTools(tools, { config, queryVector: null })).toBe(
    tools,
  );
  expect(
    await filterMcpTools(tools, {
      config: { ...config, model: "bad" },
      queryVector: [1, 0],
      embedDocuments: async () => {
        throw Error();
      },
    }),
  ).toBe(tools);
});
