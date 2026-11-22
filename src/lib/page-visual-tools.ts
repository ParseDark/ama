import { tool, type UIMessage } from "ai";
import { z } from "zod";
import { captureStartingViewport, type CaptureTarget } from "./capture-target";
import { captureStartingFullPage } from "./full-page-capture";
import { normalizeViewport, type CaptureImage } from "./capture-image";

export const PAGE_VISUAL_TOOLS = [
  "capture_viewport",
  "capture_full_page",
] as const;
export type PageVisualTool = (typeof PAGE_VISUAL_TOOLS)[number];
export const captureScope = (name: PageVisualTool) =>
  name === "capture_full_page" ? "Full page" : "Visible area";
export const isPageVisualTool = (name: string): name is PageVisualTool =>
  PAGE_VISUAL_TOOLS.some((item) => item === name);
export function nativeCapturePart(part: UIMessage["parts"][number]) {
  return part.type.startsWith("tool-") && isPageVisualTool(part.type.slice(5));
}
export const capturePageImage = async (
  name: PageVisualTool,
  target: CaptureTarget,
  signal?: AbortSignal,
) =>
  name === "capture_full_page"
    ? captureStartingFullPage(target, signal)
    : captureStartingViewport(target, signal, normalizeViewport);

export type CaptureFeedback = {
  toolCallId: string;
  note: string;
  failed?: boolean;
};
export type CaptureReceipt =
  | { ok: true; toolCallId: string; detail: string; note: string }
  | { ok: false; error: string };
export const coverageLabel = ({ coverage }: CaptureImage) =>
  coverage?.partial
    ? `Partial: ${coverage.start}–${coverage.end} of ${coverage.total} CSS px from the top`
    : undefined;

export class CaptureAttempts {
  private claims = new Set<string>();
  claim(chatId: string, turnId: string, messages: UIMessage[]) {
    const key = JSON.stringify([chatId, turnId]);
    if (this.claims.has(key)) return false;
    this.claims.add(key);
    const index = messages.findLastIndex(
      (message) => message.id === turnId && message.role === "user",
    );
    return (
      index >= 0 &&
      !messages.slice(index + 1).some((m) => m.parts.some(nativeCapturePart))
    );
  }
}

export function createPageVisualTools(options?: {
  target?: CaptureTarget;
  claim: () => boolean;
  capture?: typeof capturePageImage;
  receive: (
    image: CaptureImage,
    name: PageVisualTool,
    toolCallId: string,
    target: CaptureTarget,
  ) => boolean;
}) {
  const inputSchema = z.object({}).strict();
  const definition = (name: PageVisualTool, description: string) => {
    if (!options) return tool({ inputSchema, description });
    return tool({
      inputSchema,
      description,
      execute: async (
        input,
        { toolCallId, abortSignal },
      ): Promise<CaptureReceipt> => {
        if (!options.claim())
          return {
            ok: false,
            error:
              "The single screenshot attempt for this user turn has already been used.",
          };
        if (!inputSchema.safeParse(input).success)
          return {
            ok: false,
            error: "This tool takes no arguments or target overrides.",
          };
        if (!options.target)
          return {
            ok: false,
            error:
              "The starting page is not eligible for capture. Use a focused, non-private HTTP(S) page and ask again.",
          };
        try {
          const image = await (options.capture ?? capturePageImage)(
            name,
            options.target,
            abortSignal,
          );
          abortSignal?.throwIfAborted();
          if (!options.receive(image, name, toolCallId, options.target))
            return {
              ok: false,
              error: "The turn or model changed; the screenshot was discarded.",
            };
          const coverage = coverageLabel(image);
          return {
            ok: true,
            toolCallId,
            detail: coverage ?? "Captured",
            note: "Pixels are available only if accompanied by live AMA visual evidence; do not infer from this receipt alone.",
          };
        } catch (error) {
          abortSignal?.throwIfAborted();
          // Do not echo arbitrary browser/codec errors (they may contain URLs).
          const message = error instanceof Error ? error.message : "";
          return {
            ok: false,
            error:
              /^(The starting page|Chrome could not capture|A full-page capture|No stable full-page|Could not restore|The screenshot exceeds)/.test(
                message,
              )
                ? message
                : "Chrome could not produce the screenshot. Continue with text or ask again from the starting page.",
          };
        }
      },
    });
  };
  return {
    capture_viewport: definition(
      "capture_viewport",
      "Inspect visual evidence in the visible area of the starting webpage, without scrolling. No arguments or separate approval. Shares one screenshot attempt per user turn with capture_full_page.",
    ),
    capture_full_page: definition(
      "capture_full_page",
      "Inspect visual evidence across the main document of the starting webpage, including below the fold. Bounded scrolling and stitching; may return partial coverage. No arguments or separate approval. Shares one screenshot attempt per user turn with capture_viewport.",
    ),
  };
}
