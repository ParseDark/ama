export interface DataDescriptor {
  dataId: string;
  type: string;
  bytes: number;
  createdAt: number;
  source: string;
  label?: string;
  mimeType?: string;
  count?: number;
  preview: unknown;
  previewTruncated: boolean;
}

export interface DataMetadata {
  source: string;
  toolCallId?: string;
  label?: string;
  mimeType?: string;
}

export interface DataInspectOptions {
  /** Zero-based index (UTF-16 position for strings). */
  offset?: number;
  /** Maximum characters, array elements, or object properties. */
  limit?: number;
}

export interface DataLimits {
  maxEntryBytes: number;
  maxSessionBytes: number;
  maxGlobalBytes: number;
  maxSessionRecords: number;
  maxGlobalRecords: number;
  ttlMs: number;
  previewBytes: number;
}

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
