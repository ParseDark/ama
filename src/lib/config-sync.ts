import { browser } from "wxt/browser";
import { z } from "zod";
import {
  DEFAULT_EMBEDDING,
  DEFAULT_MCP_SERVERS,
  settingsStore,
  type Settings,
} from "./settings";
import { memoryStore, setMemoryEnabled } from "./memory/store";

export const SYNC_STATE_KEY = "ama.configSync";
export const SYNC_MANIFEST_KEY = "ama.config.manifest";
const PREFIX = "ama.config.chunk.";
const ALARM = "ama-config-sync";
const MAX_TEXT = 1024 * 1024;
const MAX_CLOUD = 45000;
const MAX_PARTS = 7;
const textEncoder = new TextEncoder();
const string = z.string().max(100000);
const provider = z.object({
  apiKey: string,
  model: string,
  baseURL: string,
  models: z.array(string).max(10000).optional(),
});
const snapshotSchema = z.object({
  version: z.literal(1),
  settings: z.object({
    provider: z.enum(["openai", "anthropic", "google", "openai-compatible"]),
    providers: z.object({
      openai: provider,
      anthropic: provider,
      google: provider,
      "openai-compatible": provider,
    }),
    dangerMode: z.boolean().optional(),
    webSearch: z
      .object({
        enabled: z.boolean(),
        provider: z.literal("deepseek"),
        apiKey: string,
      })
      .optional(),
    embedding: z.object({
      enabled: z.boolean(),
      url: string,
      model: string,
      token: string,
      dimensions: z.number().int().positive().max(100000),
      minScore: z.number().finite(),
    }),
    mcpServers: z
      .array(
        z.object({
          id: string,
          name: string,
          url: string,
          token: string,
          headers: z.record(z.string(), string).optional(),
          enabled: z.boolean(),
        }),
      )
      .max(1000),
  }),
  memoryEnabled: z.boolean(),
});
export type ConfigSnapshot = z.infer<typeof snapshotSchema>;
const revisionSchema = z.object({
  time: z.number().int().nonnegative(),
  id: z.string().uuid(),
});
export type Revision = z.infer<typeof revisionSchema>;
const manifestSchema = z.object({
  version: z.literal(1),
  revision: revisionSchema,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  parts: z.number().int().min(1).max(MAX_PARTS),
  encoding: z.literal("gzip-base64"),
});
type Manifest = z.infer<typeof manifestSchema>;
export interface ConfigSyncState {
  enabled: boolean;
  baseline?: string;
  revision?: Revision;
  pending?: { revision: Revision; hash: string };
  lastUploadAt?: number;
  lastDownloadAt?: number;
  error?: string;
}
export type ConfigSyncAction =
  | "enable-upload"
  | "enable-download"
  | "upload"
  | "download"
  | "disable"
  | "clear-cloud";
class SyncError extends Error {}
export const compareRevision = (a: Revision, b: Revision) =>
  a.time - b.time || a.id.localeCompare(b.id);
export async function getConfigSyncState(): Promise<ConfigSyncState> {
  const data = await browser.storage.local.get(SYNC_STATE_KEY);
  return {
    enabled: false,
    ...(data[SYNC_STATE_KEY] as Partial<ConfigSyncState> | undefined),
  };
}
const saveState = (state: ConfigSyncState) =>
  browser.storage.local.set({ [SYNC_STATE_KEY]: state });
export async function captureConfig(): Promise<ConfigSnapshot> {
  const settings = await settingsStore.getValue();
  return snapshotSchema.parse({
    version: 1,
    settings: {
      ...settings,
      embedding: { ...DEFAULT_EMBEDDING, ...settings.embedding },
      mcpServers: settings.mcpServers ?? DEFAULT_MCP_SERVERS,
    },
    memoryEnabled: (await memoryStore.getValue()).enabled,
  });
}
const digest = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", textEncoder.encode(text)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const encode64 = (data: Uint8Array) => {
  let s = "";
  for (let i = 0; i < data.length; i += 8192)
    s += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(s);
};
async function compress(text: string) {
  const stream = new Blob([textEncoder.encode(text)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return encode64(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function decompress(encoded: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length > MAX_CLOUD)
    throw new SyncError("Invalid cloud configuration encoding.");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  } catch {
    throw new SyncError("Invalid cloud configuration encoding.");
  }
  const reader = new Blob([new Uint8Array(bytes).buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_TEXT) {
        await reader.cancel();
        throw new SyncError(
          "Cloud configuration exceeds the 1 MiB decoded limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(result);
}
export async function packConfig(snapshot: ConfigSnapshot, revision: Revision) {
  const text = JSON.stringify(snapshotSchema.parse(snapshot));
  if (textEncoder.encode(text).byteLength > MAX_TEXT)
    throw new SyncError(
      "Configuration exceeds the 1 MiB decoded limit. Nothing uploaded.",
    );
  const encoded = await compress(text);
  if (encoded.length > MAX_CLOUD)
    throw new SyncError(
      "Configuration exceeds the safe Chrome sync quota. Reduce fetched model lists or server configuration; nothing uploaded.",
    );
  const values: Record<string, unknown> = {};
  const parts = Math.ceil(encoded.length / 7000);
  for (let i = 0; i < parts; i++)
    values[`${PREFIX}${revision.id}.${i}`] = encoded.slice(
      i * 7000,
      (i + 1) * 7000,
    );
  const manifest: Manifest = {
    version: 1,
    revision,
    hash: await digest(text),
    parts,
    encoding: "gzip-base64",
  };
  values[SYNC_MANIFEST_KEY] = manifest;
  return { values, manifest };
}
export async function unpackConfig(
  values: Record<string, unknown>,
): Promise<{ snapshot: ConfigSnapshot; manifest: Manifest } | null> {
  if (values[SYNC_MANIFEST_KEY] === undefined) return null;
  const parsed = manifestSchema.safeParse(values[SYNC_MANIFEST_KEY]);
  if (!parsed.success)
    throw new SyncError(
      "Cloud configuration format is invalid or unsupported.",
    );
  const manifest = parsed.data;
  let encoded = "";
  for (let i = 0; i < manifest.parts; i++) {
    const part = values[`${PREFIX}${manifest.revision.id}.${i}`];
    if (typeof part !== "string" || part.length > 7000)
      throw new SyncError(
        "Cloud snapshot is incomplete. Chrome may still be syncing; retry shortly.",
      );
    encoded += part;
  }
  const text = await decompress(encoded);
  if ((await digest(text)) !== manifest.hash)
    throw new SyncError(
      "Cloud snapshot integrity check failed. Local settings were not replaced.",
    );
  const data = snapshotSchema.safeParse(JSON.parse(text));
  if (!data.success)
    throw new SyncError(
      "Cloud configuration format is invalid or unsupported.",
    );
  return { snapshot: data.data, manifest };
}
function revisionAfter(...revisions: (Revision | undefined)[]): Revision {
  return {
    time: Math.max(Date.now(), ...revisions.map((r) => (r?.time ?? 0) + 1)),
    id: crypto.randomUUID(),
  };
}
const cloudKeys = (data: Record<string, unknown>) =>
  Object.keys(data).filter(
    (k) => k === SYNC_MANIFEST_KEY || k.startsWith(PREFIX),
  );
const bytesInItems = (data: Record<string, unknown>) =>
  Object.entries(data).reduce(
    (n, [k, v]) =>
      n +
      textEncoder.encode(k).length +
      textEncoder.encode(JSON.stringify(v)).length,
    0,
  );

/** One background owner. A local serialized queue + persistent pending revision
 * avoid echo writes and survive worker suspension; cloud delivery is eventual,
 * not a distributed transaction. Last revision wins the whole config. */
export class ConfigSync {
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  run(action?: ConfigSyncAction): Promise<{ ok: boolean; error?: string }> {
    const job = this.queue.then(async () => {
      try {
        await this.process(action);
        return { ok: true };
      } catch (e) {
        const error =
          e instanceof SyncError
            ? e.message
            : "Chrome configuration sync failed. Check Chrome sync/account status or quota, then retry. Local settings are retained.";
        const state = await getConfigSyncState();
        await saveState({ ...state, error });
        if (state.enabled)
          await browser.alarms.create(ALARM, { when: Date.now() + 60000 });
        return { ok: false, error };
      }
    });
    this.queue = job.catch(() => {});
    return job;
  }
  async noticeLocalChange() {
    // Persist the dirty revision promptly; debounce only the network-area write.
    const job = this.queue.then(async () => {
      const state = await getConfigSyncState();
      if (!state.enabled) return;
      const hash = await digest(JSON.stringify(await captureConfig()));
      if (hash !== state.baseline && hash !== state.pending?.hash)
        await saveState({
          ...state,
          pending: {
            hash,
            revision: revisionAfter(state.revision, state.pending?.revision),
          },
        });
      if (hash !== state.baseline || state.pending) {
        await browser.alarms.create(ALARM, { when: Date.now() + 30000 });
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          void this.run();
        }, 5000);
      }
    });
    this.queue = job.catch(async () => {
      const state = await getConfigSyncState();
      await saveState({
        ...state,
        error:
          "Could not prepare configuration sync. Local settings are retained.",
      });
    });
    await this.queue;
  }
  private async apply(snapshot: ConfigSnapshot) {
    // Only the enable flag, never memory text/events/vectors/history or handles.
    await setMemoryEnabled(snapshot.memoryEnabled);
    await settingsStore.setValue(snapshot.settings as Settings);
  }
  private async process(action?: ConfigSyncAction) {
    let state = await getConfigSyncState();
    if (action === "disable") {
      await saveState({
        ...state,
        enabled: false,
        pending: undefined,
        error: undefined,
      });
      await browser.alarms.clear(ALARM);
      if (this.timer) clearTimeout(this.timer);
      return;
    }
    if (action === "clear-cloud") {
      if (state.enabled)
        throw new SyncError(
          "Disable configuration sync on this device before clearing cloud data. Disable other devices too, or they may upload again.",
        );
      const cloud = await browser.storage.sync.get(null);
      await browser.storage.sync.remove(cloudKeys(cloud));
      await saveState({ ...state, error: undefined });
      return;
    }
    if (!state.enabled && !action?.startsWith("enable-")) return;
    const cloud = await browser.storage.sync.get(null);
    // Explicit upload can recover malformed/incomplete cloud snapshots; automatic
    // cycles never replace unknown cloud data without a successful validation.
    let remote: Awaited<ReturnType<typeof unpackConfig>> = null;
    if (action !== "enable-upload" && action !== "upload")
      remote = await unpackConfig(cloud);
    const forceUpload = action === "enable-upload" || action === "upload";
    const forceDownload = action === "enable-download" || action === "download";
    if (forceDownload) {
      if (!remote)
        throw new SyncError(
          "No cloud configuration is available yet. Upload from your other device first.",
        );
      await this.apply(remote.snapshot);
      await saveState({
        ...state,
        enabled: true,
        baseline: remote.manifest.hash,
        revision: remote.manifest.revision,
        pending: undefined,
        lastDownloadAt: Date.now(),
        error: undefined,
      });
      return;
    }
    const snapshot = await captureConfig();
    const hash = await digest(JSON.stringify(snapshot));
    if (hash !== state.baseline && hash !== state.pending?.hash) {
      state = {
        ...state,
        pending: {
          hash,
          revision: revisionAfter(state.revision, state.pending?.revision),
        },
      };
      await saveState(state);
    }
    if (
      !forceUpload &&
      remote &&
      (!state.pending ||
        compareRevision(remote.manifest.revision, state.pending.revision) >
          0) &&
      (!state.revision ||
        compareRevision(remote.manifest.revision, state.revision) > 0)
    ) {
      if (hash !== remote.manifest.hash) await this.apply(remote.snapshot);
      await saveState({
        ...state,
        baseline: remote.manifest.hash,
        revision: remote.manifest.revision,
        pending: undefined,
        lastDownloadAt: Date.now(),
        error: undefined,
      });
      return;
    }
    if (
      !forceUpload &&
      !state.pending &&
      remote &&
      state.revision &&
      compareRevision(state.revision, remote.manifest.revision) > 0 &&
      hash !== remote.manifest.hash
    ) {
      state = { ...state, pending: { hash, revision: state.revision } };
    }
    if (!forceUpload && !state.pending) {
      if (state.error) await saveState({ ...state, error: undefined });
      return;
    }
    const cloudRevision = manifestSchema.safeParse(cloud[SYNC_MANIFEST_KEY]);
    const revision = forceUpload
      ? revisionAfter(
          state.revision,
          state.pending?.revision,
          cloudRevision.success ? cloudRevision.data.revision : undefined,
        )
      : state.pending!.revision;
    const packed = await packConfig(snapshot, revision);
    // Retain the previous complete generation until the replacement is written;
    // observers must validate parts/hash before applying any snapshot.
    const previous = manifestSchema.safeParse(cloud[SYNC_MANIFEST_KEY]);
    const stale = cloudKeys(cloud).filter(
      (k) =>
        k.startsWith(PREFIX) &&
        (!previous.success ||
          !k.startsWith(`${PREFIX}${previous.data.revision.id}.`)),
    );
    if (stale.length) await browser.storage.sync.remove(stale);
    const remaining = Object.fromEntries(
      Object.entries(cloud).filter(([k]) => !stale.includes(k)),
    );
    if (bytesInItems({ ...remaining, ...packed.values }) > 100000)
      throw new SyncError(
        "Not enough Chrome sync quota for a safe configuration replacement. Nothing uploaded.",
      );
    await browser.storage.sync.set(packed.values);
    await saveState({
      ...state,
      enabled: true,
      baseline: packed.manifest.hash,
      revision,
      pending: undefined,
      lastUploadAt: Date.now(),
      error: undefined,
    });
    // Do not clean up another device's newer generation in an interleaved write.
    const now = await browser.storage.sync.get(null);
    const latest = manifestSchema.safeParse(now[SYNC_MANIFEST_KEY]);
    if (latest.success && latest.data.revision.id === revision.id) {
      // Remove only pre-upload keys, not another writer's newly staged chunks.
      const obsolete = cloudKeys(cloud).filter(
        (k) =>
          k.startsWith(PREFIX) && !k.startsWith(`${PREFIX}${revision.id}.`),
      );
      if (obsolete.length) await browser.storage.sync.remove(obsolete);
    }
    await browser.alarms.clear(ALARM);
  }
}
export function startConfigSync() {
  // Content scripts do not need cloud configuration/credential access.
  void browser.storage.sync
    .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch(() => {});
  const sync = new ConfigSync();
  browser.storage.onChanged.addListener((changes, area) => {
    if (
      area === "sync" &&
      Object.keys(changes).some(
        (k) => k === SYNC_MANIFEST_KEY || k.startsWith(PREFIX),
      )
    ) {
      void browser.alarms.create(ALARM, { when: Date.now() + 30000 });
      void sync.run();
    }
    if (
      area === "local" &&
      (changes.settings ||
        (changes.memory &&
          (changes.memory.oldValue as { enabled?: boolean } | undefined)
            ?.enabled !==
            (changes.memory.newValue as { enabled?: boolean } | undefined)
              ?.enabled))
    )
      void sync.noticeLocalChange();
  });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void sync.run();
  });
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "ama:config-sync") return;
    if (
      sender.id !== browser.runtime.id ||
      sender.url?.split("?")[0] !== browser.runtime.getURL("/sidepanel.html")
    )
      return;
    const actions: ConfigSyncAction[] = [
      "enable-upload",
      "enable-download",
      "upload",
      "download",
      "disable",
      "clear-cloud",
    ];
    if (!actions.includes(message.action)) return;
    void sync.run(message.action).then(sendResponse);
    return true;
  });
  void sync.run();
  return sync;
}
