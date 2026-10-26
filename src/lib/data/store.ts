import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  DataDescriptor,
  DataInspectOptions,
  DataLimits,
  DataMetadata,
  JsonValue,
} from "./types";

export const DEFAULT_DATA_LIMITS: Readonly<DataLimits> = Object.freeze({
  maxEntryBytes: 16 * 1024 * 1024,
  maxSessionBytes: 64 * 1024 * 1024,
  maxGlobalBytes: 256 * 1024 * 1024,
  maxSessionRecords: 1000,
  maxGlobalRecords: 10000,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  previewBytes: 2048,
});
const encoder = new TextEncoder();
const size = (value: unknown) =>
  encoder.encode(JSON.stringify(value)).byteLength;
const unavailable = () => new Error("Data not found or unavailable");
interface Meta {
  descriptor: DataDescriptor;
  sessionId: string;
  toolCallId?: string;
  expiresAt: number;
}
interface DataDB extends DBSchema {
  metadata: { key: string; value: Meta; indexes: { session: string } };
  values: { key: string; value: JsonValue };
  tombstones: { key: string; value: { sessionId: string } };
}
let database: Promise<IDBPDatabase<DataDB>> | undefined;
function db() {
  return (database ??= openDB<DataDB>("ama-data", 1, {
    upgrade(database) {
      database
        .createObjectStore("metadata", { keyPath: "descriptor.dataId" })
        .createIndex("session", "sessionId");
      database.createObjectStore("values");
      database.createObjectStore("tombstones", { keyPath: "sessionId" });
    },
  }));
}

/** Validate before stringify: JSON.stringify alone silently drops undefined/functions. */
export function normalizeData(value: unknown): JsonValue {
  const ancestors = new Set<object>();
  function check(item: unknown): JsonValue {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object")
      throw new Error(
        "Data must be a JSON value (no undefined, BigInt, functions, or non-finite numbers)",
      );
    if (ancestors.has(item)) throw new Error("Data must not contain cycles");
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      throw new Error("Data must contain only JSON objects and arrays");
    }
    ancestors.add(item);
    const normalized: JsonValue[] | Record<string, JsonValue> = Array.isArray(
      item,
    )
      ? []
      : {};
    if (Object.getOwnPropertySymbols(item).length)
      throw new Error("Data must not contain symbol keys");
    const keys = Array.isArray(item)
      ? Array.from({ length: item.length }, (_, index) => String(index))
      : Object.keys(item);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !("value" in descriptor))
        throw new Error("Data must not contain accessors or sparse arrays");
      Object.defineProperty(normalized, key, {
        value: check(descriptor.value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    ancestors.delete(item);
    return normalized;
  }
  try {
    return check(value);
  } catch (error) {
    if (error instanceof RangeError)
      throw new Error("Data nesting is too deep");
    throw error;
  }
}

function bounded(
  value: JsonValue,
  budget: number,
  depth = 0,
): { value: JsonValue; truncated: boolean } {
  if (typeof value === "string") {
    if (size(value) <= budget) return { value, truncated: false };
    let low = 0,
      high = value.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (size(value.slice(0, mid)) <= budget) low = mid;
      else high = mid - 1;
    }
    // Never end a truncated preview on half of a surrogate pair.
    if (low && /[\uD800-\uDBFF]/.test(value[low - 1])) low--;
    return { value: value.slice(0, low), truncated: true };
  }
  if (value === null || typeof value !== "object") {
    return size(value) <= budget
      ? { value, truncated: false }
      : { value: null, truncated: true };
  }
  const array = Array.isArray(value);
  const result: JsonValue[] | Record<string, JsonValue> = array ? [] : {};
  const keys = Object.keys(value);
  if (depth >= 8) return { value: result, truncated: keys.length > 0 };
  let used = 2,
    truncated = false,
    taken = 0;
  for (const key of keys) {
    const overhead = (taken ? 1 : 0) + (array ? 0 : size(key) + 1);
    const remaining = budget - used - overhead;
    if (remaining < 4) {
      truncated = true;
      break;
    }
    const child = bounded(
      (value as Record<string, JsonValue>)[key],
      remaining,
      depth + 1,
    );
    if (array) (result as JsonValue[]).push(child.value);
    else
      Object.defineProperty(result, key, {
        value: child.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    used += overhead + size(child.value);
    taken++;
    truncated ||= child.truncated;
  }
  return { value: result, truncated: truncated || taken < keys.length };
}

function preview(
  value: JsonValue,
  options: DataInspectOptions,
  budget: number,
) {
  const { offset = 0, limit = 100 } = options;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  ) {
    throw new Error(
      "Invalid preview pagination: offset must be a nonnegative integer; limit must be 1–1000",
    );
  }
  let page = value,
    omitted = false;
  if (typeof value === "string" || Array.isArray(value)) {
    page = value.slice(offset, offset + limit);
    omitted = (offset > 0 && value.length > 0) || offset + limit < value.length;
  } else if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    page = Object.fromEntries(
      keys.slice(offset, offset + limit).map((key) => [key, value[key]]),
    );
    omitted = (offset > 0 && keys.length > 0) || offset + limit < keys.length;
  }
  const result = bounded(page, budget);
  return {
    preview: result.value,
    previewTruncated: omitted || result.truncated,
  };
}

export function createDataStore(options: {
  sessionId: string;
  limits?: Partial<DataLimits>;
  now?: () => number;
}) {
  const { sessionId, now = Date.now } = options;
  if (!sessionId) throw new Error("A sessionId is required");
  const limits = { ...DEFAULT_DATA_LIMITS, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`Invalid data limit: ${name}`);
  }
  if (limits.previewBytes < 4 || limits.previewBytes > 4096)
    throw new Error("previewBytes must be 4–4096");
  return {
    async save(
      input: unknown,
      metadata: DataMetadata,
    ): Promise<DataDescriptor> {
      if (
        !metadata ||
        typeof metadata.source !== "string" ||
        !metadata.source ||
        metadata.source.length > 1024
      )
        throw new Error(
          "Data source must be a nonempty string up to 1024 characters",
        );
      for (const name of ["label", "mimeType", "toolCallId"] as const) {
        if (
          metadata[name] !== undefined &&
          (typeof metadata[name] !== "string" || metadata[name]!.length > 1024)
        )
          throw new Error(`Invalid data metadata: ${name}`);
      }
      const value = normalizeData(input);
      const bytes = size(value);
      if (bytes > limits.maxEntryBytes)
        throw new Error("Data capacity exceeded: entry byte limit");
      const createdAt = now();
      const descriptor: DataDescriptor = {
        dataId: crypto.randomUUID(),
        type:
          value === null
            ? "null"
            : Array.isArray(value)
              ? "array"
              : typeof value,
        bytes,
        createdAt,
        source: metadata.source,
        ...(metadata.label !== undefined ? { label: metadata.label } : {}),
        ...(metadata.mimeType !== undefined
          ? { mimeType: metadata.mimeType }
          : {}),
        ...(typeof value === "string" || Array.isArray(value)
          ? { count: value.length }
          : value && typeof value === "object"
            ? { count: Object.keys(value).length }
            : {}),
        ...preview(value, {}, limits.previewBytes),
      };
      const database = await db();
      const tx = database.transaction(
        ["metadata", "values", "tombstones"],
        "readwrite",
      );
      // Handle abort rejections even when an earlier request/validation throws.
      void tx.done.catch(() => {});
      try {
        if (await tx.objectStore("tombstones").get(sessionId))
          throw unavailable();
        let globalBytes = 0,
          sessionBytes = 0,
          globalCount = 0,
          sessionCount = 0;
        let cursor = await tx.objectStore("metadata").openCursor();
        while (cursor) {
          const record = cursor.value;
          if (record.expiresAt <= createdAt) {
            await tx.objectStore("values").delete(cursor.primaryKey);
            await cursor.delete();
          } else {
            globalBytes += record.descriptor.bytes;
            globalCount++;
            if (record.sessionId === sessionId) {
              sessionBytes += record.descriptor.bytes;
              sessionCount++;
            }
          }
          cursor = await cursor.continue();
        }
        if (
          globalBytes + bytes > limits.maxGlobalBytes ||
          sessionBytes + bytes > limits.maxSessionBytes ||
          globalCount >= limits.maxGlobalRecords ||
          sessionCount >= limits.maxSessionRecords
        ) {
          throw new Error(
            "Data capacity exceeded: session/global byte or record limit",
          );
        }
        await tx.objectStore("metadata").add({
          descriptor,
          sessionId,
          ...(metadata.toolCallId !== undefined
            ? { toolCallId: metadata.toolCallId }
            : {}),
          expiresAt: createdAt + limits.ttlMs,
        });
        await tx.objectStore("values").add(value, descriptor.dataId);
        await tx.done;
        return descriptor;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* already settled */
        }
        throw error;
      }
    },
    async load(dataId: string): Promise<unknown> {
      const database = await db();
      const tx = database.transaction(
        ["metadata", "values", "tombstones"],
        "readonly",
      );
      const record = await tx.objectStore("metadata").get(dataId);
      if (
        !record ||
        record.sessionId !== sessionId ||
        record.expiresAt <= now() ||
        (await tx.objectStore("tombstones").get(sessionId))
      )
        throw unavailable();
      return await tx.objectStore("values").get(dataId);
    },
    async inspect(
      dataId: string,
      pagination: DataInspectOptions = {},
    ): Promise<DataDescriptor> {
      const database = await db();
      const tx = database.transaction(
        ["metadata", "values", "tombstones"],
        "readonly",
      );
      const record = await tx.objectStore("metadata").get(dataId);
      if (
        !record ||
        record.sessionId !== sessionId ||
        record.expiresAt <= now() ||
        (await tx.objectStore("tombstones").get(sessionId))
      )
        throw unavailable();
      const value = await tx.objectStore("values").get(dataId);
      return {
        ...record.descriptor,
        ...preview(value!, pagination, limits.previewBytes),
      };
    },
    async list(): Promise<DataDescriptor[]> {
      const database = await db();
      const tx = database.transaction(
        ["metadata", "values", "tombstones"],
        "readwrite",
      );
      if (await tx.objectStore("tombstones").get(sessionId)) return [];
      const results: DataDescriptor[] = [];
      let cursor = await tx.objectStore("metadata").openCursor();
      const timestamp = now();
      while (cursor) {
        const record = cursor.value;
        if (record.expiresAt <= timestamp) {
          // Inspect metadata only; deleting an expired raw value never reads it.
          await tx.objectStore("values").delete(cursor.primaryKey);
          await cursor.delete();
        } else if (record.sessionId === sessionId && results.length < 100) {
          results.push(record.descriptor);
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      return results;
    },
    async remove(dataId: string): Promise<void> {
      const database = await db();
      const tx = database.transaction(
        ["metadata", "values", "tombstones"],
        "readwrite",
      );
      const record = await tx.objectStore("metadata").get(dataId);
      if (
        !record ||
        record.sessionId !== sessionId ||
        record.expiresAt <= now() ||
        (await tx.objectStore("tombstones").get(sessionId))
      )
        throw unavailable();
      await tx.objectStore("metadata").delete(dataId);
      await tx.objectStore("values").delete(dataId);
      await tx.done;
    },
  };
}

/** A permanent tombstone prevents already-started saves from resurrecting deleted sessions. */
export async function deleteSessionData(sessionId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(
    ["metadata", "values", "tombstones"],
    "readwrite",
  );
  await tx.objectStore("tombstones").put({ sessionId });
  let cursor = await tx
    .objectStore("metadata")
    .index("session")
    .openCursor(sessionId);
  while (cursor) {
    await tx.objectStore("values").delete(cursor.primaryKey);
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Test/reset helper; unlike session deletion, also clears tombstones. */
export async function clearDataStore(): Promise<void> {
  const database = await db();
  const tx = database.transaction(
    ["metadata", "values", "tombstones"],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("metadata").clear(),
    tx.objectStore("values").clear(),
    tx.objectStore("tombstones").clear(),
  ]);
  await tx.done;
}
