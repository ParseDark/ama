import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSettings } from "@/components/file-settings";
import { FileWorkspace, type Directory } from "@/lib/files/workspace";
import { createFileTools } from "@/lib/files/tools";

const state = vi.hoisted(() => ({
  load: vi.fn(),
  backups: vi.fn(async () => []),
}));
vi.mock("@/lib/files/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files/workspace")>()),
  getWorkspace: state.load,
  listBackups: state.backups,
}));
afterEach(() => vi.restoreAllMocks());
function handle(read: PermissionState, write: PermissionState) {
  return {
    name: "test-project",
    queryPermission: vi.fn(async (o: { mode: string }) =>
      o.mode === "read" ? read : write,
    ),
    requestPermission: vi.fn(async () => "granted" as PermissionState),
  } as unknown as Directory;
}
describe("workspace permission recovery", () => {
  it("preserves connected/read-only state and returns actionable structured tool errors", async () => {
    const h = handle("granted", "prompt");
    const workspace = new FileWorkspace(async () => ({
      id: "test",
      handle: h,
    }));
    expect((await workspace.access()).handle).toBe(h);
    await expect(workspace.access(true)).rejects.toMatchObject({
      code: "WORKSPACE_PERMISSION_REQUIRED",
      details: {
        workspace: "test-project",
        mode: "readwrite",
        state: "prompt",
      },
    });
    expect(h.requestPermission).not.toHaveBeenCalled();
    vi.mocked(h.queryPermission).mockResolvedValue("denied");
    const tools = createFileTools(workspace) as any;
    const result = await tools.list_files.execute(
      { pattern: "**/*", limit: 10 },
      {},
    );
    expect(result).toMatchObject({
      ok: false,
      code: "WORKSPACE_PERMISSION_REQUIRED",
      workspace: "test-project",
      mode: "read",
      state: "denied",
    });
    expect(result.error).toContain("NOT a disconnected folder");
    expect(result.error).toContain("Open AMA in tab");
  });
  it("requests on the click stack without waiting for IndexedDB and reports denied permission", async () => {
    const h = handle("granted", "prompt");
    state.load.mockResolvedValue({ id: "test", handle: h });
    const root = createRoot(
      document.body.appendChild(document.createElement("div")),
    );
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => {
        root.render(<FileSettings />);
      });
      expect(document.body.textContent).toContain(
        "Read: granted · Write: prompt",
      );
      const button = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Reauthorize",
      )!;
      const reads = state.load.mock.calls.length;
      let onClickStack = false;
      vi.mocked(h.requestPermission).mockImplementation(() => {
        expect(onClickStack).toBe(true);
        expect(state.load.mock.calls.length).toBe(reads);
        return Promise.resolve("denied");
      });
      await act(async () => {
        onClickStack = true;
        button.click();
        onClickStack = false;
      });
      expect(h.requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "did not grant",
      );
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "folder is still connected",
      );
    } finally {
      await act(async () => root.unmount());
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });
  it("displays permission API exceptions rather than silently implying authorization", async () => {
    const h = handle("prompt", "prompt");
    state.load.mockResolvedValue({ id: "test", handle: h });
    vi.mocked(h.requestPermission).mockRejectedValue(
      new DOMException("User activation required", "SecurityError"),
    );
    const root = createRoot(
      document.body.appendChild(document.createElement("div")),
    );
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => {
        root.render(<FileSettings />);
      });
      await act(async () => {
        Array.from(document.querySelectorAll("button"))
          .find((b) => b.textContent === "Reauthorize")!
          .click();
      });
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "User activation required",
      );
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Open AMA in tab",
      );
    } finally {
      await act(async () => root.unmount());
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
