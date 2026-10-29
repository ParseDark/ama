import { browser } from "wxt/browser";
import type { CaptureSnapshot, CaptureStatus } from "./types";

async function request<T>(
  action: string,
  sessionId: string,
  tabId?: number,
): Promise<T> {
  const response = await browser.runtime.sendMessage({
    type: "network-capture",
    action,
    sessionId,
    tabId,
  });
  if (!response?.ok)
    throw new Error(response?.error || "Network capture failed");
  return response.value as T;
}
export const networkClient = {
  start: (sessionId: string, tabId?: number) =>
    request<CaptureStatus>("start", sessionId, tabId),
  stop: (sessionId: string) => request<CaptureSnapshot>("stop", sessionId),
  status: (sessionId: string) => request<CaptureStatus>("status", sessionId),
  clear: (sessionId: string) => request<void>("clear", sessionId),
};
export type NetworkClient = typeof networkClient;
