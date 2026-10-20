import { openDB } from "idb";
import ignore from "ignore";
import { applyPatch, createTwoFilesPatch, parsePatch } from "diff";
import { permissionError, WorkspaceAccessError } from "./permissions";

// Handles are kept in IndexedDB, never serialized to chrome.storage or sent to models.
export type Directory = FileSystemDirectoryHandle & {
  queryPermission(options: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission(options: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};
export interface Workspace {
  id: string;
  handle: Directory;
}
export interface Backup {
  id: string;
  workspace: string;
  path: string;
  text: string;
  at: number;
}
const db = () =>
  openDB("ama-files", 1, {
    upgrade(db) {
      db.createObjectStore("workspace");
      db.createObjectStore("backups", { keyPath: "id" });
    },
  });
export const MAX_FILE_BYTES = 1024 * 1024;
export const FILE_TOOLS = [
  "list_files",
  "find_files",
  "search_files",
  "read_file",
  "create_file",
  "edit_file",
  "patch_file",
  "delete_file",
];
export async function getWorkspace(): Promise<Workspace | undefined> {
  return (await db()).get("workspace", "current");
}
export async function connectWorkspace(handle: Directory) {
  await navigator.locks.request("ama-file-write", async () => {
    await (
      await db()
    ).put("workspace", { id: crypto.randomUUID(), handle }, "current");
  });
}
export async function disconnectWorkspace() {
  await navigator.locks.request("ama-file-write", async () => {
    await (await db()).delete("workspace", "current");
  });
}
export async function listBackups(): Promise<Backup[]> {
  return ((await (await db()).getAll("backups")) as Backup[]).sort(
    (a, b) => b.at - a.at,
  );
}
export async function clearBackups() {
  await (await db()).clear("backups");
}
async function backup(workspace: Workspace, path: string, text: string) {
  const database = await db();
  const tx = database.transaction("backups", "readwrite");
  const records = (await tx.store.getAll()) as Backup[];
  records.sort((a, b) => b.at - a.at);
  for (const old of records.slice(19)) await tx.store.delete(old.id);
  await tx.store.put({
    id: crypto.randomUUID(),
    workspace: workspace.handle.name,
    path,
    text,
    at: Date.now(),
  });
  await tx.done;
}
export function safePath(path: string) {
  if (
    !path ||
    path.length > 512 ||
    /[\\:\x00-\x1f\x7f]/.test(path) ||
    path.startsWith("/") ||
    path.endsWith("/")
  )
    throw new Error("Use a relative file path within the workspace.");
  const segments = path.split("/");
  if (segments.some((s) => !s || s === "." || s === ".." || s.trim() !== s))
    throw new Error("Unsafe path.");
  if (
    segments.some((s) =>
      /^(?:\.git|\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.npmrc|\.netrc|\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\..*)?|secrets?(?:\..*)?)$/i.test(
        s,
      ),
    ) ||
    /\.(?:pem|key|p12|pfx|keystore)$/i.test(path)
  )
    throw new Error("Sensitive paths are blocked.");
  return segments;
}
export function globMatch(pattern: string, path: string) {
  if (pattern.length > 200 || /[\\\x00-\x1f]/.test(pattern))
    throw new Error("Invalid pattern.");
  // Bounded dynamic programming, never a model-supplied/backtracking regex.
  const tokens = pattern.toLowerCase().match(/\*\*\/|\*\*|\*|\?|[^*?]/g) ?? [];
  const target = path.toLowerCase();
  let next = new Uint8Array(target.length + 1);
  next[target.length] = 1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i],
      current = new Uint8Array(target.length + 1);
    if (token === "**/") {
      let laterSlashMatch = 0;
      for (let j = target.length; j >= 0; j--) {
        if (target[j] === "/" && next[j + 1]) laterSlashMatch = 1;
        current[j] = next[j] || laterSlashMatch;
      }
    } else
      for (let j = target.length; j >= 0; j--) {
        current[j] =
          token === "*" || token === "**"
            ? next[j] ||
              Number(
                j < target.length &&
                  (token === "**" || target[j] !== "/") &&
                  !!current[j + 1],
              )
            : Number(
                j < target.length &&
                  (token === "?" ? target[j] !== "/" : token === target[j]) &&
                  !!next[j + 1],
              );
      }
    next = current;
  }
  return !!next[0];
}
export async function decodeFile(file: File) {
  if (file.size > MAX_FILE_BYTES)
    throw new Error("Text file exceeds 1 MiB limit.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) throw new Error("Binary files are not supported.");
  // Preserve UTF-8 BOM when writing back. Reject non-UTF8 rather than corrupt it.
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
export async function sha256(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function exactEdit(
  text: string,
  edits: { oldText: string; newText: string }[],
) {
  const changes = edits
    .map((e) => {
      const start = text.indexOf(e.oldText);
      if (!e.oldText || start < 0 || text.indexOf(e.oldText, start + 1) !== -1)
        throw new Error("oldText must match exactly once.");
      return { ...e, start, end: start + e.oldText.length };
    })
    .sort((a, b) => a.start - b.start);
  if (changes.some((c, i) => i > 0 && c.start < changes[i - 1].end))
    throw new Error("Edits overlap.");
  let result = text;
  for (const c of changes.reverse())
    result = result.slice(0, c.start) + c.newText + result.slice(c.end);
  return result;
}
export function strictPatch(text: string, path: string, patch: string) {
  const parsed = parsePatch(patch);
  if (parsed.length !== 1)
    throw new Error(
      "One file per patch; create/delete/rename use separate tools.",
    );
  const p = parsed[0];
  const strip = (s?: string) => s?.replace(/^[ab]\//, "");
  if (strip(p.oldFileName) !== path || strip(p.newFileName) !== path)
    throw new Error("Patch paths must match the requested file.");
  // Verify original hunk positions ourselves: jsdiff otherwise allows offset search.
  const lines = text.split(/\r\n|\n/);
  let end = 0;
  for (const h of p.hunks) {
    const start = h.oldLines === 0 ? h.oldStart : h.oldStart - 1;
    if (start < end || start < 0 || start > lines.length)
      throw new Error("Invalid/overlapping hunk positions.");
    const old = h.lines
      .filter((l) => l[0] === " " || l[0] === "-")
      .map((l) => l.slice(1).replace(/\r$/, ""));
    if (old.length !== h.oldLines || old.some((l, i) => l !== lines[start + i]))
      throw new Error("Patch context/position mismatch; reread the file.");
    end = start + h.oldLines;
  }
  const result = applyPatch(text, p, {
    fuzzFactor: 0,
    autoConvertLineEndings: true,
  });
  if (result === false) throw new Error("Patch could not be applied exactly.");
  return result;
}

export class FileWorkspace {
  constructor(private load = getWorkspace) {}
  async access(write = false) {
    const workspace = await this.load();
    if (!workspace)
      throw new WorkspaceAccessError(
        "WORKSPACE_NOT_CONNECTED",
        "No workspace connected. Ask the user to select a directory in Settings → Tools → Files.",
      );
    const mode = write ? "readwrite" : "read";
    const state = await workspace.handle.queryPermission({ mode });
    if (state !== "granted") throw permissionError(workspace, mode, state);
    return workspace;
  }
  private async rules(w: Workspace) {
    const rules = ignore().add([
      "node_modules/",
      "dist/",
      "build/",
      ".output/",
      ".venv/",
      ".venv-cpu/",
      ".git/",
      ".env",
      ".env.*",
      "*.pem",
      "*.key",
      "*.p12",
      "*.pfx",
    ]);
    try {
      rules.add(
        await decodeFile(
          await (await w.handle.getFileHandle(".gitignore")).getFile(),
        ),
      );
    } catch (e) {
      if ((e as DOMException).name !== "NotFoundError") throw e;
    }
    return rules;
  }
  private async locate(w: Workspace, path: string) {
    const parts = safePath(path);
    if ((await this.rules(w)).ignores(path))
      throw new Error("Path excluded by workspace ignore rules.");
    let dir = w.handle;
    for (const name of parts.slice(0, -1))
      dir = (await dir.getDirectoryHandle(name)) as Directory;
    return { dir, name: parts.at(-1)! };
  }
  async read(path: string) {
    const workspace = await this.access();
    const { dir, name } = await this.locate(workspace, path);
    return {
      workspace,
      text: await decodeFile(await (await dir.getFileHandle(name)).getFile()),
    };
  }
  async files(pattern = "**/*", signal?: AbortSignal) {
    const workspace = await this.access(),
      rules = await this.rules(workspace);
    const files: { path: string; handle: FileSystemFileHandle }[] = [];
    let visited = 0,
      truncated = false;
    const walk = async (dir: Directory, prefix: string, depth: number) => {
      if (depth > 20) {
        truncated = true;
        return;
      }
      for await (const [name, handle] of dir.entries()) {
        signal?.throwIfAborted();
        if (++visited > 10000) {
          truncated = true;
          return;
        }
        const path = prefix + name;
        try {
          safePath(path);
        } catch {
          continue;
        }
        if (rules.ignores(path + (handle.kind === "directory" ? "/" : "")))
          continue;
        if (handle.kind === "directory")
          await walk(handle as Directory, path + "/", depth + 1);
        else if (globMatch(pattern, path)) {
          files.push({ path, handle: handle as FileSystemFileHandle });
          if (files.length >= 2000) {
            truncated = true;
            return;
          }
        }
        if (visited > 10000 || files.length >= 2000) return;
      }
    };
    await walk(workspace.handle, "", 0);
    return { workspace, files, truncated };
  }
  async prepare(
    action: "create" | "edit" | "patch" | "delete",
    path: string,
    input: {
      content?: string;
      edits?: { oldText: string; newText: string }[];
      patch?: string;
    },
  ) {
    const workspace = await this.access(true);
    const { dir, name } = await this.locate(workspace, path);
    let before: string | null = null;
    try {
      before = await decodeFile(
        await (await dir.getFileHandle(name)).getFile(),
      );
    } catch (e) {
      if ((e as DOMException).name !== "NotFoundError") throw e;
    }
    if (action === "create" && before !== null)
      throw new Error("File already exists; create never overwrites.");
    if (action !== "create" && before === null)
      throw new Error("File does not exist.");
    const after =
      action === "delete"
        ? null
        : action === "create"
          ? input.content!
          : action === "edit"
            ? exactEdit(before!, input.edits!)
            : strictPatch(before!, path, input.patch!);
    if (
      after !== null &&
      new TextEncoder().encode(after).length > MAX_FILE_BYTES
    )
      throw new Error("Result exceeds 1 MiB.");
    if (before === after) throw new Error("No changes.");
    const diff = createTwoFilesPatch(
      path,
      path,
      before ?? "",
      after ?? "",
      undefined,
      undefined,
      { timeout: 1000, maxEditLength: 20000 },
    );
    if (diff === undefined)
      throw new Error("Diff exceeds complexity limit; make smaller edits.");
    return {
      workspace: { ...workspace },
      path,
      action,
      before,
      after,
      hash: before === null ? null : await sha256(before),
      diff,
    };
  }
  async commit(preview: Awaited<ReturnType<FileWorkspace["prepare"]>>) {
    return navigator.locks.request("ama-file-write", async () => {
      const w = await this.access(true);
      if (w.id !== preview.workspace.id)
        throw new Error("Workspace changed; request a new preview.");
      const { dir, name } = await this.locate(w, preview.path);
      let current: string | null = null;
      try {
        current = await decodeFile(
          await (await dir.getFileHandle(name)).getFile(),
        );
      } catch (e) {
        if ((e as DOMException).name !== "NotFoundError") throw e;
      }
      if ((current === null ? null : await sha256(current)) !== preview.hash)
        throw new Error(
          "File changed since preview; nothing written. Reread and request approval again.",
        );
      if (current !== null) await backup(w, preview.path, current);
      if (preview.after === null)
        await dir.removeEntry(name); // Never recursive.
      else {
        const handle = await dir.getFileHandle(name, { create: true });
        const stream = await handle.createWritable();
        try {
          await stream.write(preview.after);
          await stream.close();
        } catch (e) {
          await stream.abort().catch(() => {});
          throw e;
        }
      }
      return {
        ok: true,
        path: preview.path,
        action: preview.action,
        backup: current !== null,
      };
    });
  }
}
export const fileWorkspace = new FileWorkspace();
