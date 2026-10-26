import { parse } from "es-module-lexer/js";
import workerSource from "./sandbox-worker.js?raw";

export const EXECUTION_TIMEOUT_MS = 10_000;

/** Only rewrite actual module specifiers, never comments or string contents. */
export async function rewriteImports(code: string) {
  const [imports] = parse(code);
  let result = code;
  for (const entry of [...imports].reverse()) {
    if (!entry.n || /^(?:[./#]|[a-z][a-z\d+.-]*:)/i.test(entry.n)) continue;
    const url = `https://esm.sh/${entry.n}`;
    result =
      result.slice(0, entry.s) +
      (entry.d >= 0 ? JSON.stringify(url) : url) +
      result.slice(entry.e);
  }
  return result;
}

export interface SandboxRequest {
  id: string;
  code: string;
  input: unknown;
}
export interface SandboxResponse {
  id: string;
  ok: boolean;
  result: unknown;
  logs: string[];
  error: string | null;
}

/** One Worker per request; the timer lives outside the worker's event loop. */
export function executeSandbox(
  request: SandboxRequest,
  respond: (response: SandboxResponse) => void,
) {
  const logs: string[] = [];
  let worker: Worker | undefined;
  let workerURL: string | undefined;
  let finished = false;
  const finish = (ok: boolean, result: unknown, error: string | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    worker?.terminate();
    if (workerURL) URL.revokeObjectURL(workerURL);
    respond({ id: request.id, ok, result, logs, error });
  };
  const timer = setTimeout(
    () => finish(false, null, "Execution timed out after 10s."),
    EXECUTION_TIMEOUT_MS,
  );
  void (async () => {
    try {
      const code = await rewriteImports(request.code);
      if (finished) return;
      workerURL = URL.createObjectURL(
        new Blob([workerSource], { type: "text/javascript" }),
      );
      // A classic blob Worker can start from the sandbox's opaque origin;
      // dynamic import() inside it still loads the generated ES module.
      worker = new Worker(workerURL);
      worker.onmessage = ({ data }) => {
        if (data.type === "log") logs.push(data.text);
        else if (data.type === "result") finish(true, data.result, null);
        else if (data.type === "error") finish(false, null, data.error);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(false, null, event.message || "Worker execution failed.");
      };
      worker.onmessageerror = () =>
        finish(false, null, "Could not read Worker result.");
      worker.postMessage({ code, input: request.input });
    } catch (error) {
      finish(
        false,
        null,
        error instanceof Error ? error.message : String(error),
      );
    }
  })();
}
