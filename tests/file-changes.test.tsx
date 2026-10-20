import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "ai";
import {
  changedFiles,
  clearFileChanges,
  loadFileChange,
  netFileAction,
  previewDiff,
  saveFileChange,
  type FileChangeSnapshot,
} from "@/lib/files/changes";
import { FileChanges } from "@/components/file-changes";
import { messageText } from "@/lib/messages";
import { saveSession, loadSession } from "@/lib/sessions";
const snapshot = (
  id: string,
  overrides: Partial<FileChangeSnapshot> = {},
): FileChangeSnapshot => ({
  id,
  workspaceId: "w",
  workspace: "project",
  path: "a.txt",
  action: "edit",
  before: "old\n",
  after: "new\n",
  at: Date.now(),
  ...overrides,
});
const part = (s: FileChangeSnapshot, overrides: any = {}) => {
  const { before, after, at, ...change } = s;
  return {
    type: "tool-edit_file",
    toolCallId: s.id,
    state: "output-available",
    input: {},
    output: { ok: true, change },
    ...overrides,
  };
};
const message = (parts: any[]): UIMessage => ({
  id: "a",
  role: "assistant",
  parts,
});
beforeEach(clearFileChanges);
describe("reply file change receipts and local snapshots", () => {
  it("groups same file across operations/workspaces and excludes denied/failed/read tools", () => {
    const a = snapshot("1"),
      b = snapshot("2"),
      c = snapshot("3", { path: "b.txt" }),
      d = snapshot("4", { workspaceId: "other" });
    const grouped = changedFiles(
      message([
        part(a),
        part(b),
        part(c),
        part(d),
        part(a),
        part(snapshot("bad"), { output: { ok: false } }),
        part(snapshot("denied"), { state: "output-denied" }),
        part(snapshot("read"), { type: "tool-read_file" }),
      ]),
    );
    expect(grouped).toHaveLength(3);
    expect(grouped[0].receipts.map((r) => r.id)).toEqual(["1", "2"]);
    expect(changedFiles({ ...message([part(a)]), role: "user" })).toEqual([]);
  });
  it("persists literal snapshots locally but only receipts in chat/model outputs", async () => {
    const s = snapshot("1", { after: "<script>window.BAD=true</script>" });
    await saveFileChange(s);
    expect(await loadFileChange(s)).toEqual(s);
    expect(await loadFileChange({ ...s, path: "wrong.txt" })).toBeUndefined();
    const m = message([part(s), { type: "text", text: "Done" }]);
    await saveSession("file-previews", [
      { id: "u", role: "user", parts: [{ type: "text", text: "Edit" }] },
      m,
    ]);
    const loaded = (await loadSession("file-previews"))[1];
    expect(changedFiles(loaded)).toHaveLength(1);
    expect(JSON.stringify(loaded)).not.toContain("window.BAD");
    expect(messageText(loaded)).toBe("Done");
    const html = renderToStaticMarkup(<FileChanges message={loaded} />);
    expect(html).toContain("1 file changed");
    expect(html).toContain("Preview a.txt");
    await clearFileChanges();
    expect(await loadFileChange(s)).toBeUndefined();
  });
  it("retains latest 100 bounded operations and reports net create/delete/revert", async () => {
    for (let i = 0; i < 102; i++)
      await saveFileChange(snapshot(String(i), { at: i }));
    expect(await loadFileChange(snapshot("0"))).toBeUndefined();
    expect(await loadFileChange(snapshot("101"))).toBeDefined();
    expect(netFileAction(null, "a")).toBe("Created");
    expect(netFileAction("a", null)).toBe("Deleted");
    expect(netFileAction(null, null)).toBe("Created then deleted");
    expect(netFileAction("a", "a")).toContain("reverted");
    expect(previewDiff("a\n", "b\n", "x.txt")).toContain("+b");
  });
});
