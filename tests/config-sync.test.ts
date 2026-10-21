import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { browser } from "wxt/browser";
import {
  ConfigSync,
  SYNC_MANIFEST_KEY,
  SYNC_STATE_KEY,
  captureConfig,
  getConfigSyncState,
  packConfig,
  unpackConfig,
} from "@/lib/config-sync";
import { DEFAULT_SETTINGS, settingsStore } from "@/lib/settings";
import { memoryStore } from "@/lib/memory/store";

const rev = (time = 1) => ({ time, id: crypto.randomUUID() });
beforeEach(async () => {
  // happy-dom's crypto lacks subtle; compression uses native browser-compatible Web Streams.
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("navigator", {
    locks: { request: async (_name: string, fn: () => unknown) => fn() },
  });
  await settingsStore.setValue(structuredClone(DEFAULT_SETTINGS));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function privateConfig() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.dangerMode = true;
  settings.fontScale = 1.15;
  settings.webSearch = {
    enabled: true,
    provider: "deepseek",
    apiKey: "test-secret-search",
  };
  settings.providers.openai.apiKey = "test-secret-provider";
  settings.providers.openai.models = ["model-one", "model-two"];
  settings.mcpServers = [
    {
      id: "test",
      name: "Test",
      url: "https://mcp.test",
      token: "test-secret-mcp",
      headers: { "X-Key": "test-secret-header" },
      enabled: true,
    },
  ];
  settings.embedding = {
    enabled: true,
    url: "http://127.0.0.1:8765/v1",
    model: "test",
    token: "test-secret-embed",
    dimensions: 1024,
    minScore: 0.28,
  };
  await settingsStore.setValue(settings);
  await memoryStore.setValue({
    schemaVersion: 1,
    enabled: false,
    memories: [{ id: "private-memory", text: "DO_NOT_SYNC_MEMORY" } as any],
  });
  await browser.storage.local.set({ "session:private": "DO_NOT_SYNC_HISTORY" });
  return settings;
}
it("round trips every config/credential with compression, never memory or history", async () => {
  const settings = await privateConfig();
  const snapshot = await captureConfig();
  const packed = await packConfig(snapshot, rev());
  const decoded = await unpackConfig(packed.values);
  expect(decoded?.snapshot.settings).toEqual(settings);
  expect(decoded?.snapshot.memoryEnabled).toBe(false);
  expect(JSON.stringify(decoded)).not.toContain("DO_NOT_SYNC");
  expect(
    Object.values(packed.values)
      .filter((v) => typeof v === "string")
      .every((v) => (v as string).length <= 7000),
  ).toBe(true);
});
it("is off by default, opt-in upload includes secrets, and disable retains both copies", async () => {
  await privateConfig();
  const sync = new ConfigSync();
  await sync.run();
  expect(await browser.storage.sync.get(null)).toEqual({});
  expect((await getConfigSyncState()).enabled).toBe(false);
  expect(await sync.run("enable-upload")).toEqual({ ok: true });
  expect((await getConfigSyncState()).enabled).toBe(true);
  const cloud = await browser.storage.sync.get(null);
  expect(
    (await unpackConfig(cloud))?.snapshot.settings.providers.openai.apiKey,
  ).toBe("test-secret-provider");
  await sync.run("disable");
  await settingsStore.setValue(DEFAULT_SETTINGS);
  await sync.run();
  expect(await browser.storage.sync.get(null)).toEqual(cloud);
  await sync.run("clear-cloud");
  expect(await browser.storage.sync.get(null)).toEqual({});
});
it("cloud opt-in replaces all settings but preserves memory contents and other local state", async () => {
  const original = await privateConfig();
  const remote = await captureConfig();
  const packed = await packConfig(remote, rev(100));
  await browser.storage.sync.set(packed.values);
  await settingsStore.setValue(DEFAULT_SETTINGS);
  await memoryStore.setValue({
    schemaVersion: 1,
    enabled: true,
    memories: [{ id: "local-only", text: "local-memory" } as any],
  });
  const sync = new ConfigSync();
  expect(await sync.run("enable-download")).toEqual({ ok: true });
  expect(await settingsStore.getValue()).toEqual(original);
  expect(await memoryStore.getValue()).toMatchObject({
    enabled: false,
    memories: [{ id: "local-only" }],
  });
  expect(
    (await browser.storage.local.get("session:private"))["session:private"],
  ).toBe("DO_NOT_SYNC_HISTORY");
  expect((await getConfigSyncState()).pending).toBeUndefined();
});
it("rejects incomplete/corrupt snapshots and schema errors without replacing local credentials", async () => {
  await privateConfig();
  const sync = new ConfigSync();
  const snapshot = await captureConfig();
  const packed = await packConfig(snapshot, rev());
  await browser.storage.sync.set({ [SYNC_MANIFEST_KEY]: packed.manifest });
  expect((await sync.run("enable-download")).ok).toBe(false);
  expect((await settingsStore.getValue()).providers.openai.apiKey).toBe(
    "test-secret-provider",
  );
  expect((await getConfigSyncState()).enabled).toBe(false);
  const key = Object.keys(packed.values).find((k) => k !== SYNC_MANIFEST_KEY)!;
  await expect(
    unpackConfig({ ...packed.values, [key]: "invalid" }),
  ).rejects.toThrow();
  await expect(
    unpackConfig({ [SYNC_MANIFEST_KEY]: { version: 99 } }),
  ).rejects.toThrow("format");
  await browser.storage.sync.clear();
  expect((await sync.run("enable-download")).error).toContain("No cloud");
});
it("automatic changes upload once and newer remote revisions win without echo uploads", async () => {
  await privateConfig();
  const sync = new ConfigSync();
  await sync.run("enable-upload");
  const edited = await settingsStore.getValue();
  edited.providers.openai.model = "local-edit";
  await settingsStore.setValue(edited);
  await sync.run();
  expect(
    (await unpackConfig(await browser.storage.sync.get(null)))?.snapshot
      .settings.providers.openai.model,
  ).toBe("local-edit");
  const remote = await captureConfig();
  remote.settings.providers.openai.model = "remote-edit";
  const revision = rev(Date.now() + 100000);
  await browser.storage.sync.set((await packConfig(remote, revision)).values);
  const set = vi.spyOn(browser.storage.sync, "set");
  await sync.run();
  expect((await settingsStore.getValue()).providers.openai.model).toBe(
    "remote-edit",
  );
  await sync.run();
  expect(set).not.toHaveBeenCalled();
  expect((await getConfigSyncState()).revision).toEqual(revision);
});
it("keeps last valid cloud config when quota fails and sanitizes browser errors", async () => {
  await privateConfig();
  const sync = new ConfigSync();
  await sync.run("enable-upload");
  const cloud = await browser.storage.sync.get(null);
  const settings = await settingsStore.getValue();
  settings.providers.openai.apiKey = "new-secret";
  await settingsStore.setValue(settings);
  const set = vi
    .spyOn(browser.storage.sync, "set")
    .mockRejectedValue(new Error("quota with new-secret"));
  const result = await sync.run();
  expect(result.ok).toBe(false);
  expect(result.error).not.toContain("new-secret");
  expect(await browser.storage.sync.get(null)).toEqual(cloud);
  expect((await settingsStore.getValue()).providers.openai.apiKey).toBe(
    "new-secret",
  );
  set.mockRestore();
  await sync.run();
  expect((await getConfigSyncState()).error).toBeUndefined();
});
it("clear cloud requires disabled sync and never deletes another extension-owned sync key", async () => {
  const sync = new ConfigSync();
  await sync.run("enable-upload");
  expect((await sync.run("clear-cloud")).ok).toBe(false);
  await browser.storage.sync.set({ unrelated: "keep" });
  await sync.run("disable");
  await sync.run("clear-cloud");
  expect(await browser.storage.sync.get(null)).toEqual({ unrelated: "keep" });
});
it("persists dirty state before a debounced write so a restarted worker can resume", async () => {
  await privateConfig();
  const sync = new ConfigSync();
  await sync.run("enable-upload");
  const before = await browser.storage.sync.get(null);
  const settings = await settingsStore.getValue();
  settings.providers.google.apiKey = "new-google-key";
  await settingsStore.setValue(settings);
  vi.useFakeTimers();
  await sync.noticeLocalChange();
  expect((await getConfigSyncState()).pending).toBeDefined();
  expect(await browser.storage.sync.get(null)).toEqual(before);
  await new ConfigSync().run();
  expect(
    (await unpackConfig(await browser.storage.sync.get(null)))?.snapshot
      .settings.providers.google.apiKey,
  ).toBe("new-google-key");
  vi.clearAllTimers();
});
it("a dirty revision survives worker restart and beats an older late cloud write", async () => {
  const sync = new ConfigSync();
  await sync.run("enable-upload");
  const old = await browser.storage.sync.get(null);
  const settings = await settingsStore.getValue();
  settings.providers.openai.model = "newer-local";
  await settingsStore.setValue(settings);
  await sync.run();
  const state = await getConfigSyncState();
  await browser.storage.sync.set(old);
  await new ConfigSync().run();
  expect(
    (await unpackConfig(await browser.storage.sync.get(null)))?.snapshot
      .settings.providers.openai.model,
  ).toBe("newer-local");
  expect((await getConfigSyncState()).revision).toEqual(state.revision);
  expect(
    (await browser.storage.local.get(SYNC_STATE_KEY))[SYNC_STATE_KEY],
  ).toBeDefined();
});
