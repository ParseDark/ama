import { tool } from "ai";
import { z } from "zod";
import { runCode } from "./code-runner";

export function createCodeTools(execute: typeof runCode = runCode) {
  return {
    run_js: tool({
      description:
        "Execute JavaScript for computation or data processing in an isolated sandbox. " +
        "Provide an ES module exporting `export default async function(input) { ... }`. " +
        "npm imports are supported (for example, import _ from 'lodash'). " +
        "Pass JSON input and return a JSON-serializable result. " +
        "Code runs in a Worker with no DOM, browser extension APIs, or page access, " +
        "and a 10-second execution limit. Returns {id, ok, result, logs, error}; " +
        "logs contains console output and error is null on success.",
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            "JavaScript ES module with a default async function(input) export",
          ),
        input: z.json().describe("JSON input passed to the default function"),
      }),
      execute: ({ code, input }) => execute(code, input),
    }),
  };
}
