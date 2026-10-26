import { afterEach, expect, it, vi } from "vitest";
import { executeSandbox, rewriteImports } from "@/lib/sandbox-runtime";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("rewrites static, scoped, versioned, re-export and literal dynamic imports", async () => {
  const code = `import x from 'lodash-es';
import '@scope/pkg@1/sub';
export {x} from "pkg/sub";
const p = import('nanoid');
import 'https://example.com/a.js';
import './local.js';
// import 'not-a-package'
const s = "import 'also-not-a-package'";`;
  const result = await rewriteImports(code);
  for (const name of ["lodash-es", "@scope/pkg@1/sub", "pkg/sub", "nanoid"])
    expect(result).toContain(`https://esm.sh/${name}`);
  expect(result).toContain("// import 'not-a-package'");
  expect(result).toContain("\"import 'also-not-a-package'\"");
  expect(result).toContain("import './local.js'");
  expect(result).toContain("import 'https://example.com/a.js'");
});

it("terminates a stalled Worker after 10 seconds and preserves logs", async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  let worker: any;
  vi.stubGlobal(
    "Worker",
    class {
      onmessage: any;
      terminate = terminate;
      postMessage = vi.fn();
      constructor() {
        worker = this;
      }
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const respond = vi.fn();
  executeSandbox(
    { id: "a", code: "export default () => 1", input: null },
    respond,
  );
  await vi.advanceTimersByTimeAsync(0);
  worker.onmessage({ data: { type: "log", text: "started" } });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(terminate).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith("blob:test");
  expect(respond).toHaveBeenCalledWith({
    id: "a",
    ok: false,
    result: null,
    logs: ["started"],
    error: "Execution timed out after 10s.",
  });
});

it("returns a Worker result once and releases resources", async () => {
  let worker: any;
  const terminate = vi.fn();
  vi.stubGlobal(
    "Worker",
    class {
      onmessage: any;
      terminate = terminate;
      postMessage = vi.fn();
      constructor() {
        worker = this;
      }
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const respond = vi.fn();
  executeSandbox(
    { id: "a", code: "export default () => 1", input: null },
    respond,
  );
  await vi.waitFor(() => expect(worker).toBeDefined());
  worker.onmessage({ data: { type: "result", result: 42 } });
  worker.onmessage({ data: { type: "result", result: 99 } });
  expect(respond).toHaveBeenCalledExactlyOnceWith({
    id: "a",
    ok: true,
    result: 42,
    logs: [],
    error: null,
  });
  expect(terminate).toHaveBeenCalledOnce();
});
