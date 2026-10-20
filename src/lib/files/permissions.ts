import type { Directory, Workspace } from "./workspace";

export interface WorkspacePermissions {
  read: PermissionState;
  readwrite: PermissionState;
}
export async function inspectWorkspacePermissions(
  handle: Directory,
): Promise<WorkspacePermissions> {
  const [read, readwrite] = await Promise.all([
    handle.queryPermission({ mode: "read" }),
    handle.queryPermission({ mode: "readwrite" }),
  ]);
  return { read, readwrite };
}

/** Call directly from a click with an already-loaded handle: no IndexedDB await
 * before requestPermission, which requires transient user activation. Never
 * request permissions from model tool calls or automatic effects. */
export function requestWorkspacePermission(
  handle: Directory,
): Promise<PermissionState> {
  return handle.requestPermission({ mode: "readwrite" });
}

export class WorkspaceAccessError extends Error {
  constructor(
    public code: "WORKSPACE_NOT_CONNECTED" | "WORKSPACE_PERMISSION_REQUIRED",
    message: string,
    public details?: {
      workspace: string;
      mode: "read" | "readwrite";
      state: PermissionState;
    },
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}
export function permissionError(
  workspace: Workspace,
  mode: "read" | "readwrite",
  state: PermissionState,
) {
  return new WorkspaceAccessError(
    "WORKSPACE_PERMISSION_REQUIRED",
    `Workspace "${workspace.handle.name}" is connected, but Chrome ${mode} permission is "${state}". This is NOT a disconnected folder. Retrying tools cannot grant access. Ask the user to click Reauthorize in Settings → Tools → Files and accept Chrome's permission prompt. If Chrome cannot show a prompt in the side panel, use Open AMA in tab, then Reauthorize there (or choose the same directory again). No files were changed.`,
    { workspace: workspace.handle.name, mode, state },
  );
}
