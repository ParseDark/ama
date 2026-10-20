import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { loadFileChange } from "@/lib/files/changes";
import * as changeStore from "@/lib/files/changes";
import { createTwoFilesPatch } from "diff";
import {
  safePath,
  exactEdit,
  strictPatch,
  globMatch,
  decodeFile,
  FileWorkspace,
  type Directory,
} from "@/lib/files/workspace";
import {
  createFileTools,
  getFilePreview,
  discardFilePreview,
} from "@/lib/files/tools";

describe("workspace path and text safety", () => {
  it("blocks traversal, absolute, sensitive and malformed paths", () => {
    for (const path of [
      "../a",
      "/etc/passwd",
      "a/../b",
      "a//b",
      "a\\b",
      "C:/a",
      "a/.env.local",
      ".ssh/config",
      "a/id_rsa",
      "token.pem",
      "credentials.json",
      "a\0b",
      "a/.",
      "a/ b",
    ])
      expect(() => safePath(path), path).toThrow();
    expect(safePath("src/settings.ts")).toEqual(["src", "settings.ts"]);
  });
  it("matches only the documented glob subset", () => {
    expect(globMatch("**/*.ts", "a.ts")).toBe(true);
    expect(globMatch("src/*.ts", "src/a/b.ts")).toBe(false);
    expect(globMatch("src/**/*.t?", "src/a/b.ts")).toBe(true);
    expect(globMatch("*.ts", "axts")).toBe(false);
  });
  it("requires unique nonoverlapping original edits and preserves line endings", () => {
    expect(
      exactEdit("a\r\nb\r\n", [
        { oldText: "a", newText: "x" },
        { oldText: "b", newText: "y" },
      ]),
    ).toBe("x\r\ny\r\n");
    expect(() => exactEdit("aa", [{ oldText: "a", newText: "x" }])).toThrow(
      "exactly once",
    );
    expect(() =>
      exactEdit("abc", [
        { oldText: "ab", newText: "x" },
        { oldText: "bc", newText: "y" },
      ]),
    ).toThrow("overlap");
  });
  it("rejects offset/wrong-file/multifile patches and accepts exact hunks", () => {
    const patch = createTwoFilesPatch(
      "a.txt",
      "a.txt",
      "one\ntwo\n",
      "one\nthree\n",
    );
    expect(strictPatch("one\ntwo\n", "a.txt", patch)).toBe("one\nthree\n");
    expect(() => strictPatch("extra\none\ntwo\n", "a.txt", patch)).toThrow(
      "position mismatch",
    );
    expect(() => strictPatch("one\ntwo\n", "b.txt", patch)).toThrow("paths");
    expect(() => strictPatch("one\ntwo\n", "a.txt", patch + patch)).toThrow(
      "One file",
    );
    const crlf = "one\r\ntwo\r\n";
    expect(
      strictPatch(
        crlf,
        "a.txt",
        createTwoFilesPatch("a.txt", "a.txt", crlf, "one\r\nthree\r\n"),
      ),
    ).toBe("one\r\nthree\r\n");
  });
  it("rejects binary/invalid UTF8/oversized and preserves BOM", async () => {
    const file = (bytes: Uint8Array) =>
      ({ size: bytes.length, arrayBuffer: async () => bytes.buffer }) as File;
    expect(await decodeFile(file(new Uint8Array([239, 187, 191, 97])))).toBe(
      "\uFEFFa",
    );
    await expect(decodeFile(file(new Uint8Array([0])))).rejects.toThrow(
      "Binary",
    );
    await expect(decodeFile(file(new Uint8Array([255])))).rejects.toThrow();
    await expect(decodeFile({ size: 1024 * 1024 + 1 } as File)).rejects.toThrow(
      "1 MiB",
    );
  });
});

function virtualWorkspace() {
  const contents = new Map<string, string>([
    ["file.txt", "old\n"],
    ["ignored.txt", "hidden"],
    [".gitignore", "ignored.txt\nnode_modules/\n"],
  ]);
  const handle = {
    name: "project",
    kind: "directory",
    queryPermission: vi.fn(async () => "granted"),
    getFileHandle: vi.fn(async (name: string) => {
      if (!contents.has(name))
        throw new DOMException("missing", "NotFoundError");
      return {
        kind: "file",
        getFile: async () => {
          const text = contents.get(name)!;
          return {
            size: new TextEncoder().encode(text).length,
            arrayBuffer: async () => new TextEncoder().encode(text).buffer,
          };
        },
      };
    }),
    entries: async function* () {
      for (const name of contents.keys())
        yield [name, await handle.getFileHandle(name)];
    },
  } as unknown as Directory;
  const w = { id: "w1", handle };
  return { contents, handle, workspace: new FileWorkspace(async () => w), w };
}
describe("workspace permissions and approval binding", () => {
  it("fails closed without a directory or permission, skips ignored files", async () => {
    await expect(
      new FileWorkspace(async () => undefined).access(),
    ).rejects.toThrow("No workspace");
    const { workspace, handle } = virtualWorkspace();
    expect((await workspace.files()).files.map((f) => f.path)).not.toContain(
      "ignored.txt",
    );
    await expect(workspace.read("ignored.txt")).rejects.toThrow("ignore");
    vi.mocked(handle.queryPermission).mockResolvedValue("denied");
    await expect(workspace.read("file.txt")).rejects.toThrow("permission");
  });
  it("previews without writing, rejects overwrite and missing parents", async () => {
    const { workspace, contents } = virtualWorkspace();
    const preview = await workspace.prepare("edit", "file.txt", {
      edits: [{ oldText: "old", newText: "new" }],
    });
    expect(preview.diff).toContain("+new");
    expect(contents.get("file.txt")).toBe("old\n");
    await expect(
      workspace.prepare("create", "file.txt", { content: "oops" }),
    ).rejects.toThrow("already exists");
    await expect(
      workspace.prepare("delete", "missing.txt", {}),
    ).rejects.toThrow("does not exist");
  });
  it("requires preview matching original call, never executes approved model inputs directly", async () => {
    const { workspace } = virtualWorkspace();
    const commit = vi.spyOn(workspace, "commit").mockResolvedValue({
      ok: true,
      path: "file.txt",
      action: "edit",
      backup: true,
    });
    const tools = createFileTools(workspace) as any;
    const options = { toolCallId: "file-call", messages: [] };
    expect(
      await tools.edit_file.needsApproval(
        { path: "file.txt", edits: [{ oldText: "old", newText: "new" }] },
        options,
      ),
    ).toBe(true);
    expect(getFilePreview("file-call")?.after).toBe("new\n");
    await tools.edit_file.needsApproval(
      { path: "file.txt", edits: [{ oldText: "old", newText: "MUTATED" }] },
      {
        ...options,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "file-call",
                toolName: "edit_file",
                input: {},
              },
            ],
          },
        ],
      },
    );
    expect(getFilePreview("file-call")?.after).toBe("new\n");
    const result = await tools.edit_file.execute(
      { path: "wrong", edits: [] },
      options,
    );
    expect(result).toMatchObject({
      ok: true,
      change: { path: "file.txt", action: "edit" },
    });
    expect(JSON.stringify(result)).not.toContain("new\\n");
    expect(await loadFileChange(result.change)).toMatchObject({
      before: "old\n",
      after: "new\n",
    });
    expect(commit.mock.calls[0][0].path).toBe("file.txt");
    expect(commit.mock.calls[0][0].after).toBe("new\n");
    expect((await tools.edit_file.execute({}, options)).error).toContain(
      "expired",
    );
    discardFilePreview("file-call");
  });
  it("keeps successful writes successful if local preview storage fails", async () => {
    const { workspace } = virtualWorkspace();
    const commit = vi.spyOn(workspace, "commit").mockResolvedValue({
      ok: true,
      path: "file.txt",
      action: "edit",
      backup: true,
    });
    const storage = vi
      .spyOn(changeStore, "saveFileChange")
      .mockRejectedValueOnce(new Error("Quota exceeded"));
    const tools = createFileTools(workspace) as any,
      options = { toolCallId: "quota-call", messages: [] };
    try {
      await tools.edit_file.needsApproval(
        { path: "file.txt", edits: [{ oldText: "old", newText: "new" }] },
        options,
      );
      expect(await tools.edit_file.execute({}, options)).toMatchObject({
        ok: true,
        previewUnavailable: true,
        change: { path: "file.txt" },
      });
      expect(commit).toHaveBeenCalledOnce();
    } finally {
      storage.mockRestore();
    }
  });
  it("rejects concurrent modifications and switched workspaces before writing", async () => {
    const { workspace, contents, w } = virtualWorkspace();
    const preview = await workspace.prepare("delete", "file.txt", {});
    const old = navigator.locks;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: async (_: string, fn: () => Promise<unknown>) => fn() },
    });
    try {
      contents.set("file.txt", "external change");
      await expect(workspace.commit(preview)).rejects.toThrow("File changed");
      w.id = "w2";
      await expect(workspace.commit(preview)).rejects.toThrow(
        "Workspace changed",
      );
    } finally {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: old,
      });
    }
  });
});
