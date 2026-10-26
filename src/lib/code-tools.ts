import { tool } from "ai";
import { z } from "zod";
import { runCode } from "./code-runner";
import type { DataActions } from "./data/actions";

const smallJson = (maxBytes: number) =>
  z
    .json()
    .refine(
      (value) =>
        new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxBytes,
      `Inline JSON exceeds ${maxBytes} bytes; use stored data IDs instead.`,
    );

export function createCodeTools(
  data: DataActions,
  execute: typeof runCode = runCode,
) {
  return {
    run_js: tool({
      description:
        "Execute JavaScript for computation or data processing in an isolated sandbox. " +
        "Provide an ES module exporting `export default async function(input) { ... }`. " +
        "npm imports are supported (for example, import _ from 'lodash-es'). " +
        "Prefer data: {name: dataId} from read_file, list_data or a previous run_js result, " +
        "with small JSON params. The extension loads original stored values directly: " +
        "input is {data: {name: originalValue}, params}. Never copy datasets into arguments. " +
        "For small legacy calls, input alone is passed directly (max 16 KiB); do not mix modes. " +
        "Return a JSON-serializable result. Results are stored automatically: result contains " +
        "{dataId, type, bytes, preview, previewTruncated, ...}, not the raw dataset. " +
        "Use result.dataId for subsequent runs and inspect_data for bounded inspection. " +
        "Code runs in a Worker with no DOM, browser extension APIs, or page access, " +
        "and a 10-second execution limit. Returns {id, ok, result, logs, error}; " +
        "logs contains bounded console output and error is null on success.",
      inputSchema: z
        .object({
          code: z
            .string()
            .min(1)
            .max(100_000)
            .describe(
              "JavaScript ES module with a default async function(input) export",
            ),
          data: z
            .record(z.string().min(1).max(64), z.string().min(1).max(128))
            .refine(
              (refs) => Object.keys(refs).length <= 8,
              "Use at most 8 data references per run.",
            )
            .optional()
            .describe(
              "Named existing data IDs in this chat, e.g. {orders: 'data_...'}. Original data is loaded by the extension, not the model.",
            ),
          params: smallJson(4096)
            .optional()
            .describe(
              "Small JSON parameters for data-reference mode; not a dataset.",
            ),
          input: smallJson(16_384)
            .optional()
            .describe(
              "Legacy small JSON input only; mutually exclusive with data and params. Prefer data references.",
            ),
        })
        .refine(
          (args) =>
            args.input === undefined ||
            (args.data === undefined && args.params === undefined),
          "Use either input or data/params, never both.",
        ),
      execute: async (args, options) => {
        options.abortSignal?.throwIfAborted();
        const input =
          args.input !== undefined
            ? args.input
            : {
                data: Object.fromEntries(
                  await Promise.all(
                    Object.entries(args.data ?? {}).map(async ([name, id]) => [
                      name,
                      await data.load(id),
                    ]),
                  ),
                ),
                params: args.params ?? null,
              };
        options.abortSignal?.throwIfAborted();
        const response = await execute(args.code, input);
        // Console output must not become a second unbounded data channel to the model.
        let remaining = 8192;
        const logs: string[] = [];
        for (const log of response.logs) {
          if (remaining <= 0 || logs.length >= 50) break;
          const bounded = log.slice(0, Math.min(remaining, 2000));
          logs.push(bounded);
          remaining -= bounded.length;
        }
        const logsTruncated =
          logs.length !== response.logs.length ||
          logs.some((log, index) => log !== response.logs[index]);
        const bounded = { ...response, logs, logsTruncated };
        if (!response.ok) return bounded;
        options.abortSignal?.throwIfAborted();
        try {
          const result = await data.save(response.result, {
            source: "run_js",
            toolCallId: options.toolCallId,
          });
          return { ...bounded, result };
        } catch (error) {
          return {
            ...bounded,
            ok: false,
            result: null,
            error: `Could not store execution result: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
