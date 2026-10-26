import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createDataActions } from "@/lib/data/actions";
import {
  clearDataStore,
  DEFAULT_DATA_LIMITS,
  deleteSessionData,
} from "@/lib/data/store";

beforeEach(clearDataStore);
const meta = { source: "test", toolCallId: "call-1" };
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

describe("session data", () => {
  it("persists full immutable JSON and keeps descriptors free of private fields", async () => {
    const data = createDataActions({ sessionId: "a" });
    const value = {
      rows: [{ name: "中文", amount: 10 }],
      nested: { ok: true },
    };
    const descriptor = await data.save(value, {
      ...meta,
      label: "table",
      mimeType: "application/json",
    });
    value.rows[0].name = "mutated";
    expect(descriptor).toMatchObject({
      type: "object",
      bytes: bytes({
        rows: [{ name: "中文", amount: 10 }],
        nested: { ok: true },
      }),
      source: "test",
      label: "table",
      mimeType: "application/json",
      count: 2,
      previewTruncated: false,
    });
    expect(descriptor).not.toHaveProperty("sessionId");
    expect(descriptor).not.toHaveProperty("value");
    expect(descriptor).not.toHaveProperty("toolCallId");
    const reopened = createDataActions({ sessionId: "a" });
    const loaded = (await reopened.load(descriptor.dataId)) as typeof value;
    expect(loaded.rows[0].name).toBe("中文");
    loaded.rows[0].name = "again";
    (descriptor.preview as typeof value).nested.ok = false;
    expect(await reopened.load(descriptor.dataId)).toMatchObject({
      rows: [{ name: "中文" }],
      nested: { ok: true },
    });
    const listed = await data.list();
    (listed[0].preview as typeof value).nested.ok = false;
    expect((await data.list())[0].preview).toMatchObject({
      nested: { ok: true },
    });
  });

  it("isolates missing, expired and cross-session access with the same error", async () => {
    let now = 100;
    const data = createDataActions({
      sessionId: "a",
      now: () => now,
      limits: { ttlMs: 10 },
    });
    const other = createDataActions({ sessionId: "b" });
    const saved = await data.save("hello", meta);
    for (const method of ["load", "inspect", "remove"] as const) {
      await expect(other[method](saved.dataId)).rejects.toThrow(
        "Data not found or unavailable",
      );
      await expect(data[method]("missing")).rejects.toThrow(
        "Data not found or unavailable",
      );
    }
    now = 110;
    for (const method of ["load", "inspect", "remove"] as const)
      await expect(data[method](saved.dataId)).rejects.toThrow(
        "Data not found or unavailable",
      );
    expect(await data.list()).toEqual([]);
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ama-data");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const expiredRaw = await new Promise<unknown>((resolve, reject) => {
      const request = connection
        .transaction("values")
        .objectStore("values")
        .get(saved.dataId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(expiredRaw).toBeUndefined();
    connection.close();
    expect(DEFAULT_DATA_LIMITS.ttlMs).toBe(7 * 86400_000);
  });

  it("rejects values that JSON would silently lose or transform", async () => {
    const data = createDataActions({ sessionId: "a" });
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    for (const value of [
      undefined,
      { x: undefined },
      [undefined],
      BigInt(1),
      cyclic,
      NaN,
      Infinity,
      new Date(),
      new Map(),
      () => 1,
      Array(2),
      {
        toJSON() {
          return "lost";
        },
      },
    ]) {
      await expect(data.save(value, meta)).rejects.toThrow();
    }
    for (const value of [null, false, 123, "", [], {}]) {
      const saved = await data.save(value, meta);
      expect(await data.load(saved.dataId)).toEqual(value);
    }
  });

  it("bounds nested/multibyte previews by UTF-8 bytes without losing full data", async () => {
    const data = createDataActions({
      sessionId: "a",
      limits: { previewBytes: 128 },
    });
    const value = [
      { enormous: "😀汉字".repeat(10000), children: ["x".repeat(10000)] },
      { second: true },
    ];
    const saved = await data.save(value, meta);
    expect(bytes(saved.preview)).toBeLessThanOrEqual(128);
    expect(saved.previewTruncated).toBe(true);
    const page = await data.inspect(saved.dataId, { offset: 1, limit: 1 });
    expect(page.preview).toEqual([{ second: true }]);
    expect(page.previewTruncated).toBe(true);
    expect(await data.load(saved.dataId)).toEqual(value);
    const text = "😀".repeat(400);
    const str = await data.save(text, meta);
    const preview = await data.inspect(str.dataId, { limit: 1000 });
    expect(bytes(preview.preview)).toBeLessThanOrEqual(128);
    expect(preview.previewTruncated).toBe(true);
    expect(await data.load(str.dataId)).toBe(text);
    const obj = await data.save({ a: 1, b: 2, c: 3 }, meta);
    expect(
      (await data.inspect(obj.dataId, { offset: 1, limit: 1 })).preview,
    ).toEqual({ b: 2 });
    expect(
      (await data.inspect(obj.dataId, { limit: 3 })).previewTruncated,
    ).toBe(false);
    for (const args of [
      { offset: -1 },
      { offset: 0.5 },
      { limit: 0 },
      { limit: 1001 },
    ])
      await expect(data.inspect(obj.dataId, args)).rejects.toThrow(
        "pagination",
      );
  });

  it("handles deep nesting and huge keys within the hard 4KiB ceiling", async () => {
    const data = createDataActions({
      sessionId: "a",
      limits: { previewBytes: 4096 },
    });
    let nested: unknown = "secret".repeat(10000);
    for (let i = 0; i < 30; i++) nested = { nested };
    const value = { normal: nested, ["key".repeat(10000)]: 1 };
    const descriptor = await data.save(value, meta);
    expect(bytes(descriptor.preview)).toBeLessThanOrEqual(4096);
    expect(descriptor.previewTruncated).toBe(true);
    expect(await data.load(descriptor.dataId)).toEqual(value);
    expect(() =>
      createDataActions({ sessionId: "x", limits: { previewBytes: 4097 } }),
    ).toThrow();
  });

  it("enforces entry, session and global capacities atomically without eviction", async () => {
    const entry = createDataActions({
      sessionId: "entry",
      limits: { maxEntryBytes: 5 },
    });
    await expect(entry.save("汉字", meta)).rejects.toThrow("entry byte limit");
    const limits = { maxSessionBytes: 10, maxGlobalBytes: 15 };
    const a = createDataActions({ sessionId: "a", limits });
    const b = createDataActions({ sessionId: "b", limits });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => a.save("abc", meta)),
    );
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    await b.save("abc", meta);
    await expect(b.save("abc", meta)).rejects.toThrow("capacity");
    expect(await a.list()).toHaveLength(2);
    expect(await b.list()).toHaveLength(1);
  });

  it("enforces record limits, reclaims expired records and removes explicitly", async () => {
    let now = 0;
    const limits = { maxSessionRecords: 1, maxGlobalRecords: 2, ttlMs: 10 };
    const data = createDataActions({ sessionId: "a", now: () => now, limits });
    const saved = await data.save(1, meta);
    await expect(data.save(2, meta)).rejects.toThrow("capacity");
    await data.remove(saved.dataId);
    await data.save(2, meta);
    now = 10;
    const fresh = await data.save(3, meta);
    expect((await data.list()).map((x) => x.dataId)).toEqual([fresh.dataId]);
    const other = createDataActions({ sessionId: "b", now: () => now, limits });
    await other.save(1, meta);
    await expect(
      createDataActions({ sessionId: "c", now: () => now, limits }).save(
        1,
        meta,
      ),
    ).rejects.toThrow("capacity");
  });

  it("tombstones sessions against in-flight saves in either ordering", async () => {
    const data = createDataActions({ sessionId: "deleted" });
    await data.save("initial", meta);
    const inflight = Array.from({ length: 15 }, () => data.save("race", meta));
    const deletion = deleteSessionData("deleted");
    await Promise.allSettled(inflight);
    await deletion;
    expect(await data.list()).toEqual([]);
    await expect(data.save("resurrection", meta)).rejects.toThrow(
      "unavailable",
    );
    const pendingDeletion = deleteSessionData("another");
    const saving = createDataActions({ sessionId: "another" }).save(
      "late",
      meta,
    );
    await pendingDeletion;
    await expect(saving).rejects.toThrow("unavailable");
    await clearDataStore();
    await expect(data.save("reset", meta)).resolves.toHaveProperty("dataId");
  });

  it("limits lists to 100 descriptors using only the metadata store", async () => {
    const data = createDataActions({ sessionId: "a" });
    await Promise.all(
      Array.from({ length: 105 }, (_, i) => data.save({ i }, meta)),
    );
    expect(await data.list()).toHaveLength(100);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ama-data");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Remove raw values: listing still works because it never opens the values store.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("values", "readwrite");
      tx.objectStore("values").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    expect(await data.list()).toHaveLength(100);
    db.close();
  });
});
