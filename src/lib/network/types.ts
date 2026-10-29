export interface NetworkRecord {
  requestId: string;
  method: string;
  url: string;
  resourceType: "XHR" | "Fetch";
  status: number | null;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: string | null;
  responseBody: string | null;
  bodyEncoding: "utf8" | "base64";
  responseBodyTruncated: boolean;
  metadataTruncated: boolean;
  bodyError?: string;
  errorText?: string;
  startedAt: number;
  finishedAt?: number;
}
export interface CaptureStatus {
  captureId: string | null;
  tabId: number | null;
  state: "stopped" | "starting" | "capturing" | "stopping";
  count: number;
  startedAt?: number;
  reason?: string;
  limitReached: boolean;
  droppedCount: number;
  error?: string;
}
export interface CaptureSnapshot extends CaptureStatus {
  records: NetworkRecord[];
}
