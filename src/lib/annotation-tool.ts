import { tool } from "ai";
import {
  ANNOTATION_LIMITS,
  annotationInput,
  type AnnotationOperation,
} from "./annotation-schema";
import type { AnnotationResult } from "./annotation-layer";
import { browser } from "wxt/browser";
import {
  inCaptureDocument,
  verifyCaptureTarget,
  type CaptureTarget,
} from "./capture-target";

// chrome.scripting serializes this function without its module scope.
export function drawInDocument(
  op: AnnotationOperation,
  url: string,
  limit: number,
) {
  return window.__amaApplyAnnotations!(op, url, limit);
}

export function createAnnotationTools(options?: { target?: CaptureTarget }) {
  const definition = {
    inputSchema: annotationInput,
    description:
      "Draw temporary marks on the starting webpage using normalized viewport coordinates (0,0 top left; 1,1 bottom right). Add up to 32 shapes in order; use two opposite corners for an ellipse or a horizontal line for an underline. Returned IDs can replace/remove individual marks. Clear removes only AMA annotations.",
  };
  return {
    annotate_page: options
      ? tool({
          ...definition,
          execute: async (
            input,
            { abortSignal },
          ): Promise<AnnotationResult> => {
            abortSignal?.throwIfAborted();
            const parsed = annotationInput.safeParse(input);
            if (!parsed.success)
              return {
                ok: false,
                error: "Invalid annotation operation or geometry.",
              };
            const { target } = options;
            if (!target)
              return {
                ok: false,
                error: "No eligible starting webpage to annotate.",
              };
            try {
              await verifyCaptureTarget(target);
              abortSignal?.throwIfAborted();
              await browser.scripting.executeScript({
                target: {
                  tabId: target.tabId,
                  documentIds: [target.documentId],
                },
                files: ["/annotation-pen.js"],
              });
              // The tab may have changed while the local bundle was loading.
              await verifyCaptureTarget(target);
              abortSignal?.throwIfAborted();
              return await inCaptureDocument(target, drawInDocument, [
                parsed.data.operation,
                target.url,
                ANNOTATION_LIMITS.marks,
              ]);
            } catch {
              abortSignal?.throwIfAborted();
              return {
                ok: false,
                error:
                  "Could not annotate the starting webpage. Check that it is still active and try again.",
              };
            }
          },
        })
      : tool(definition),
  };
}
