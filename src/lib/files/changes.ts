import { openDB } from "idb";
import { createTwoFilesPatch } from "diff";
import type { UIMessage } from "ai";

export interface FileChangeReceipt {
  id: string;
  workspaceId: string;
  workspace: string;
  path: string;
  action: "create" | "edit" | "patch" | "delete";
}
export interface FileChangeSnapshot extends FileChangeReceipt {
  before: string | null;
  after: string | null;
  at: number;
}
export interface ChangedFile {
  key: string;
  workspace: string;
  path: string;
  receipts: FileChangeReceipt[];
}
const db = () =>
  openDB("ama-file-previews", 1, {
    upgrade(database) {
      database.createObjectStore("snapshots", { keyPath: "id" });
    },
  });
export const SNAPSHOT_LIMIT = 100;
export const SNAPSHOT_BYTES = 30 * 1024 * 1024;
const size = (s: FileChangeSnapshot) =>
  new TextEncoder().encode((s.before ?? "") + (s.after ?? "")).length;

/** Local-only snapshots: tool outputs contain the receipt, never these bodies.
 * This is separate from recovery backups; storage failure cannot undo a commit. */
export async function saveFileChange(snapshot: FileChangeSnapshot) {
  const database = await db();
  const tx = database.transaction("snapshots", "readwrite");
  const entries = ((await tx.store.getAll()) as FileChangeSnapshot[])
    .filter((s) => s.id !== snapshot.id)
    .sort((a, b) => b.at - a.at);
  let bytes = size(snapshot),
    count = 1;
  for (const s of entries) {
    if (count >= SNAPSHOT_LIMIT || bytes + size(s) > SNAPSHOT_BYTES)
      await tx.store.delete(s.id);
    else {
      count++;
      bytes += size(s);
    }
  }
  await tx.store.put(snapshot);
  await tx.done;
}
export async function loadFileChange(
  receipt: FileChangeReceipt,
): Promise<FileChangeSnapshot | undefined> {
  const s = (await (await db()).get("snapshots", receipt.id)) as
    FileChangeSnapshot | undefined;
  return s &&
    s.workspaceId === receipt.workspaceId &&
    s.path === receipt.path &&
    s.action === receipt.action
    ? s
    : undefined;
}
export async function clearFileChanges() {
  await (await db()).clear("snapshots");
}

export function changedFiles(message: UIMessage): ChangedFile[] {
  const files = new Map<string, ChangedFile>(),
    seen = new Set<string>();
  if (message.role !== "assistant") return [];
  for (const part of message.parts) {
    if (!(part.type.startsWith("tool-") || part.type === "dynamic-tool"))
      continue;
    const p = part as any,
      name = p.type === "dynamic-tool" ? p.toolName : p.type.slice(5);
    if (
      !["create_file", "edit_file", "patch_file", "delete_file"].includes(
        name,
      ) ||
      p.state !== "output-available" ||
      p.output?.ok !== true
    )
      continue;
    const r = p.output.change as FileChangeReceipt | undefined;
    if (
      !r ||
      typeof r.id !== "string" ||
      typeof r.workspaceId !== "string" ||
      typeof r.workspace !== "string" ||
      typeof r.path !== "string" ||
      !["create", "edit", "patch", "delete"].includes(r.action) ||
      seen.has(r.id)
    )
      continue;
    seen.add(r.id);
    const key = JSON.stringify([r.workspaceId, r.path]);
    if (!files.has(key))
      files.set(key, {
        key,
        workspace: r.workspace,
        path: r.path,
        receipts: [],
      });
    files.get(key)!.receipts.push(r);
  }
  return [...files.values()];
}
export function netFileAction(before: string | null, after: string | null) {
  return before === null
    ? after === null
      ? "Created then deleted"
      : "Created"
    : after === null
      ? "Deleted"
      : before === after
        ? "Unchanged (reverted)"
        : "Modified";
}
export function previewDiff(
  before: string | null,
  after: string | null,
  path: string,
) {
  const diff = createTwoFilesPatch(
    path,
    path,
    before ?? "",
    after ?? "",
    undefined,
    undefined,
    { timeout: 500, maxEditLength: 10000 },
  );
  return (
    diff ??
    "Diff is too complex to display. Use Before / After to inspect the saved text."
  );
}
