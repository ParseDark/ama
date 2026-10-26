import { tool } from "ai";
import { z } from "zod";
import type { DataActions } from "./actions";

export function createDataTools(data: DataActions) {
  return {
    list_data: tool({
      description:
        "List metadata for up to 100 saved data descriptors in this session. Preview values are omitted; use inspect_data to retrieve a bounded preview. truncated indicates the result may have reached the list limit.",
      inputSchema: z.object({}).strict(),
      execute: async () => {
        const descriptors = await data.list();
        return {
          items: descriptors.map(
            ({ preview: _preview, ...metadata }) => metadata,
          ),
          limit: 100,
          truncated: descriptors.length === 100,
        };
      },
    }),
    inspect_data: tool({
      description:
        "Inspect a saved data descriptor and a bounded preview. Paginate strings, arrays, or object properties with offset and limit; this does not load the full value into the conversation.",
      inputSchema: z
        .object({
          dataId: z
            .string()
            .min(1)
            .max(200)
            .describe("Saved data descriptor's dataId"),
          offset: z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER)
            .optional(),
          limit: z.number().int().min(1).max(1000).optional(),
        })
        .strict(),
      execute: async ({ dataId, offset, limit }) =>
        data.inspect(dataId, { offset, limit }),
    }),
  };
}
